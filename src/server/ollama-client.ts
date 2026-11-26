export interface OllamaModelCapabilities {
  role: 'chat' | 'embedding';
  supportsTools: boolean;
  supportsStructuredOutput: boolean;
  supportsStreaming: boolean;
  contextLength?: number;
  parameterSize?: string;
  family?: string;
}

export interface DiscoveredOllamaModel {
  name: string;
  sizeBytes: number;
  modifiedAt: string;
  digest: string;
  parameterSize?: string;
  family?: string;
  quantizationLevel?: string;
  capabilities: OllamaModelCapabilities;
}

export interface OllamaDiscoveryResult {
  reachable: boolean;
  endpoint: string;
  latencyMs: number;
  models: DiscoveredOllamaModel[];
  chatModels: DiscoveredOllamaModel[];
  embeddingModels: DiscoveredOllamaModel[];
  error?: string;
}

export function normalizeOllamaEndpoint(raw?: string | null): string {
  const value = (raw || process.env.OLLAMA_BASE_URL || 'http://ollama:11434').trim();
  return value.replace(/\/+$/, '');
}

const EMBEDDING_NAME_RE = /(embed|bge-|e5-|minilm|gte-|snowflake-arctic-embed)/i;

export function inferOllamaCapabilities(params: {
  name: string;
  family?: string;
  parameterSize?: string;
  capabilitiesArray?: string[];
}): OllamaModelCapabilities {
  const lowerName = params.name.toLowerCase();
  const caps = (params.capabilitiesArray || []).map((c) => c.toLowerCase());
  const isEmbedding =
    caps.includes('embedding') ||
    (!caps.includes('completion') && EMBEDDING_NAME_RE.test(lowerName));

  if (isEmbedding) {
    return {
      role: 'embedding',
      supportsTools: false,
      supportsStructuredOutput: false,
      supportsStreaming: false,
      parameterSize: params.parameterSize,
      family: params.family,
    };
  }

  const supportsTools =
    caps.includes('tools') ||
    /(llama3\.1|llama3\.2|llama3\.3|qwen2\.5|qwen3|mistral|mixtral|command-r|gemma3|phi4|deepseek)/i.test(
      lowerName
    );

  return {
    role: 'chat',
    supportsTools,
    supportsStructuredOutput: true,
    supportsStreaming: true,
    parameterSize: params.parameterSize,
    family: params.family,
  };
}

export async function inspectOllamaModel(
  endpoint: string,
  modelName: string
): Promise<{
  capabilitiesArray?: string[];
  contextLength?: number;
  parameterSize?: string;
  family?: string;
}> {
  const base = normalizeOllamaEndpoint(endpoint);
  try {
    const res = await fetch(`${base}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelName }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return {};
    const data = (await res.json()) as {
      capabilities?: string[];
      details?: { parameter_size?: string; family?: string };
      model_info?: Record<string, unknown>;
    };
    let contextLength: number | undefined;
    if (data.model_info) {
      for (const [k, v] of Object.entries(data.model_info)) {
        if (k.endsWith('.context_length') && typeof v === 'number') {
          contextLength = v;
          break;
        }
      }
    }
    return {
      capabilitiesArray: Array.isArray(data.capabilities) ? data.capabilities : undefined,
      contextLength,
      parameterSize: data.details?.parameter_size,
      family: data.details?.family,
    };
  } catch {
    return {};
  }
}

export async function discoverOllamaModels(endpoint?: string | null): Promise<OllamaDiscoveryResult> {
  const base = normalizeOllamaEndpoint(endpoint);
  const started = Date.now();
  try {
    const res = await fetch(`${base}/api/tags`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      return {
        reachable: false,
        endpoint: base,
        latencyMs,
        models: [],
        chatModels: [],
        embeddingModels: [],
        error: `Ollama returned HTTP ${res.status} at ${base}`,
      };
    }

    const payload = (await res.json()) as {
      models?: Array<{
        name: string;
        size?: number;
        modified_at?: string;
        digest?: string;
        details?: {
          parameter_size?: string;
          family?: string;
          quantization_level?: string;
        };
      }>;
    };

    const rawModels = Array.isArray(payload.models) ? payload.models : [];
    const models: DiscoveredOllamaModel[] = await Promise.all(
      rawModels.map(async (m) => {
        const showInfo = await inspectOllamaModel(base, m.name);
        const family = showInfo.family || m.details?.family;
        const parameterSize = showInfo.parameterSize || m.details?.parameter_size;
        const capabilities = inferOllamaCapabilities({
          name: m.name,
          family,
          parameterSize,
          capabilitiesArray: showInfo.capabilitiesArray,
        });
        if (showInfo.contextLength) {
          capabilities.contextLength = showInfo.contextLength;
        }
        return {
          name: m.name,
          sizeBytes: m.size ?? 0,
          modifiedAt: m.modified_at ?? '',
          digest: m.digest ?? '',
          parameterSize,
          family,
          quantizationLevel: m.details?.quantization_level,
          capabilities,
        };
      })
    );

    return {
      reachable: true,
      endpoint: base,
      latencyMs,
      models,
      chatModels: models.filter((m) => m.capabilities.role === 'chat'),
      embeddingModels: models.filter((m) => m.capabilities.role === 'embedding'),
    };
  } catch (err: unknown) {
    const latencyMs = Date.now() - started;
    const msg = err instanceof Error ? err.message : String(err);
    return {
      reachable: false,
      endpoint: base,
      latencyMs,
      models: [],
      chatModels: [],
      embeddingModels: [],
      error: `Cannot connect to Ollama at ${base} (${msg}). Ensure Ollama is running or update the endpoint URL.`,
    };
  }
}

export async function testOllamaModelConnection(params: {
  endpoint?: string | null;
  model?: string | null;
}): Promise<{
  ok: boolean;
  endpoint: string;
  latencyMs: number;
  message: string;
  discoveredModels?: string[];
}> {
  const discovery = await discoverOllamaModels(params.endpoint);
  if (!discovery.reachable) {
    return {
      ok: false,
      endpoint: discovery.endpoint,
      latencyMs: discovery.latencyMs,
      message: discovery.error || `Ollama unreachable at ${discovery.endpoint}`,
    };
  }

  const installedNames = discovery.models.map((m) => m.name);
  if (!params.model?.trim()) {
    return {
      ok: true,
      endpoint: discovery.endpoint,
      latencyMs: discovery.latencyMs,
      discoveredModels: installedNames,
      message:
        installedNames.length > 0
          ? `Connected to Ollama (${discovery.latencyMs}ms). Found ${installedNames.length} installed model(s).`
          : `Connected to Ollama (${discovery.latencyMs}ms), but 0 models are installed yet. Pull a model first.`,
    };
  }

  const targetModel = params.model.trim();
  const isInstalled = installedNames.some(
    (name) => name === targetModel || name.split(':')[0] === targetModel
  );
  if (!isInstalled) {
    return {
      ok: false,
      endpoint: discovery.endpoint,
      latencyMs: discovery.latencyMs,
      discoveredModels: installedNames,
      message: `Model "${targetModel}" is not installed in Ollama. Run: ollama pull ${targetModel}`,
    };
  }

  const started = Date.now();
  try {
    const res = await fetch(`${discovery.endpoint}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: targetModel,
        stream: false,
        messages: [{ role: 'user', content: 'Reply with OK' }],
        options: { num_predict: 12 },
      }),
      signal: AbortSignal.timeout(30000),
    });
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      const text = await res.text();
      return {
        ok: false,
        endpoint: discovery.endpoint,
        latencyMs,
        discoveredModels: installedNames,
        message: `Ollama test failed (${res.status}): ${text.slice(0, 180)}`,
      };
    }
    const data = (await res.json()) as { message?: { content?: string } };
    const reply = (data.message?.content ?? '').trim();
    return {
      ok: true,
      endpoint: discovery.endpoint,
      latencyMs,
      discoveredModels: installedNames,
      message: `Verified "${targetModel}" (${latencyMs}ms): "${reply.slice(0, 60)}"`,
    };
  } catch (err: unknown) {
    return {
      ok: false,
      endpoint: discovery.endpoint,
      latencyMs: Date.now() - started,
      discoveredModels: installedNames,
      message: `Ollama test error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export async function generateOllamaEmbeddings(params: {
  endpoint?: string | null;
  model: string;
  texts: string[];
  timeoutMs?: number;
}): Promise<{ vectors: number[][]; model: string; latencyMs: number }> {
  const base = normalizeOllamaEndpoint(params.endpoint);
  if (!params.model.trim()) {
    throw new Error('No Ollama embedding model configured.');
  }
  if (params.texts.length === 0) {
    return { vectors: [], model: params.model, latencyMs: 0 };
  }

  const started = Date.now();
  const timeoutMs = params.timeoutMs ?? 45000;

  // Modern Ollama /api/embed supports batch array input
  const res = await fetch(`${base}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: params.model.trim(),
      input: params.texts,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (res.status === 404) {
    // Fallback for older Ollama servers (< 0.2.x) using /api/embeddings sequentially
    const vectors: number[][] = [];
    for (const text of params.texts) {
      const legacyRes = await fetch(`${base}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: params.model.trim(), prompt: text }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!legacyRes.ok) {
        const msg = await legacyRes.text();
        throw new Error(`Ollama embedding failed (${legacyRes.status}): ${msg.slice(0, 180)}`);
      }
      const legacyData = (await legacyRes.json()) as { embedding?: number[] };
      if (!Array.isArray(legacyData.embedding)) {
        throw new Error('Ollama did not return a valid embedding vector.');
      }
      vectors.push(legacyData.embedding);
    }
    return { vectors, model: params.model, latencyMs: Date.now() - started };
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Ollama embedding error (${res.status}): ${errText.slice(0, 220)}`);
  }

  const data = (await res.json()) as { embeddings?: number[][] };
  if (!Array.isArray(data.embeddings) || data.embeddings.length !== params.texts.length) {
    throw new Error('Ollama returned unexpected embedding count.');
  }

  return {
    vectors: data.embeddings,
    model: params.model,
    latencyMs: Date.now() - started,
  };
}

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

export async function ollamaChatCompletion(params: {
  endpoint?: string | null;
  model: string;
  messages: OllamaMessage[];
  formatJson?: boolean;
  maxOutputTokens?: number;
  timeoutMs?: number;
  onToken?: (token: string) => void;
}): Promise<{
  text: string;
  inputTokens: number;
  outputTokens: number;
  tokensMeasured: boolean;
  latencyMs: number;
}> {
  const base = normalizeOllamaEndpoint(params.endpoint);
  if (!params.model.trim()) {
    throw new Error('No Ollama chat model selected. Choose an installed model in AI Models.');
  }

  const started = Date.now();
  const useStream = typeof params.onToken === 'function' && !params.formatJson;
  const timeoutMs = params.timeoutMs ?? Number(process.env.OLLAMA_TIMEOUT_MS || 60000);

  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: params.model.trim(),
      messages: params.messages,
      stream: useStream,
      ...(params.formatJson ? { format: 'json' } : {}),
      options: {
        temperature: params.formatJson ? 0.1 : 0.4,
        ...(params.maxOutputTokens ? { num_predict: params.maxOutputTokens } : {}),
      },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Ollama chat error (${res.status}): ${errBody.slice(0, 240)}`);
  }

  if (!useStream) {
    const data = (await res.json()) as {
      message?: { content?: string };
      prompt_eval_count?: number;
      eval_count?: number;
    };
    const inputTokens = typeof data.prompt_eval_count === 'number' ? data.prompt_eval_count : 0;
    const outputTokens = typeof data.eval_count === 'number' ? data.eval_count : 0;
    return {
      text: (data.message?.content ?? '').trim(),
      inputTokens,
      outputTokens,
      tokensMeasured: typeof data.eval_count === 'number',
      latencyMs: Date.now() - started,
    };
  }

  // Stream NDJSON lines cleanly
  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error('Ollama streaming response body missing.');
  }
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let tokensMeasured = false;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const chunk = JSON.parse(trimmed) as {
          message?: { content?: string };
          done?: boolean;
          prompt_eval_count?: number;
          eval_count?: number;
        };
        const token = chunk.message?.content ?? '';
        if (token) {
          fullText += token;
          params.onToken?.(token);
        }
        if (chunk.done) {
          if (typeof chunk.prompt_eval_count === 'number') {
            inputTokens = chunk.prompt_eval_count;
            tokensMeasured = true;
          }
          if (typeof chunk.eval_count === 'number') {
            outputTokens = chunk.eval_count;
            tokensMeasured = true;
          }
        }
      } catch {
        // Ignore partial non-JSON keepalive
      }
    }
  }

  return {
    text: fullText.trim(),
    inputTokens,
    outputTokens,
    tokensMeasured,
    latencyMs: Date.now() - started,
  };
}
