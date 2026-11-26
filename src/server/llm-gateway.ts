import { decryptSecret } from './crypto.ts';
import {
  formatGeminiError,
  generateGeminiChatbotReply,
  testGeminiConnection,
} from './gemini-gateway.ts';
import {
  generateOllamaEmbeddings,
  ollamaChatCompletion,
  testOllamaModelConnection,
} from './ollama-client.ts';

export interface ProviderConnectionRecord {
  id: string;
  provider: string; // 'ollama' | 'gemini' | 'openai_compatible'
  auth_mode: string;
  encrypted_api_key: string | null;
  endpoint: string | null;
  default_model: string;
  embedding_model?: string | null;
}

export interface LlmCompletionRequest {
  connection: ProviderConnectionRecord;
  model: string;
  systemInstruction: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  formatJson?: boolean;
  maxOutputTokens?: number;
  timeoutMs?: number;
  onToken?: (token: string) => void;
}

export interface LlmCompletionResult {
  text: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  tokensMeasured: boolean;
  latencyMs: number;
}

export interface LlmDriver {
  complete(req: LlmCompletionRequest): Promise<LlmCompletionResult>;
}

function resolveApiKey(conn: ProviderConnectionRecord): string {
  if (conn.auth_mode === 'local' || conn.provider === 'ollama') return '';
  if (conn.auth_mode === 'byok' && conn.encrypted_api_key) {
    return decryptSecret(conn.encrypted_api_key);
  }
  if (conn.provider === 'gemini') {
    return process.env.GEMINI_API_KEY?.trim() ?? '';
  }
  return '';
}

export async function testProviderConnection(params: {
  connection: ProviderConnectionRecord;
  model?: string;
}): Promise<{ ok: boolean; latencyMs: number; message: string; discoveredModels?: string[] }> {
  const { connection } = params;
  const targetModel = (params.model || connection.default_model || '').trim();

  if (connection.provider === 'ollama') {
    return testOllamaModelConnection({
      endpoint: connection.endpoint,
      model: targetModel,
    });
  }

  if (connection.provider === 'gemini') {
    const apiKey = resolveApiKey(connection);
    if (!apiKey) {
      return {
        ok: false,
        latencyMs: 0,
        message: 'Legacy Gemini provider has no API key configured.',
      };
    }
    return testGeminiConnection({
      apiKey,
      model: targetModel || 'gemini-3.1-flash-lite',
    });
  }

  if (connection.provider === 'openai_compatible') {
    const base = (connection.endpoint || '').trim().replace(/\/+$/, '');
    if (!base) {
      return { ok: false, latencyMs: 0, message: 'Endpoint URL is required for OpenAI-compatible connections.' };
    }
    const apiKey = resolveApiKey(connection);
    const started = Date.now();
    try {
      const res = await fetch(`${base}/models`, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        signal: AbortSignal.timeout(8000),
      });
      const latencyMs = Date.now() - started;
      if (!res.ok) {
        return { ok: false, latencyMs, message: `Endpoint returned HTTP ${res.status}` };
      }
      return { ok: true, latencyMs, message: `Connected to ${base} (${latencyMs}ms)` };
    } catch (err: unknown) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return { ok: false, latencyMs: 0, message: `Unsupported provider: ${connection.provider}` };
}

export async function generateProviderEmbeddings(params: {
  connection: ProviderConnectionRecord | null;
  embeddingModel?: string | null;
  texts: string[];
}): Promise<{ vectors: number[][]; model: string; latencyMs: number }> {
  const model = (params.embeddingModel || params.connection?.embedding_model || '').trim();
  const endpoint = params.connection?.endpoint;
  return generateOllamaEmbeddings({
    endpoint,
    model,
    texts: params.texts,
  });
}

export const defaultLlmDriver: LlmDriver = {
  async complete(req: LlmCompletionRequest): Promise<LlmCompletionResult> {
    const { connection } = req;
    const model = (req.model || connection.default_model || '').trim();

    if (connection.provider === 'ollama') {
      const result = await ollamaChatCompletion({
        endpoint: connection.endpoint,
        model,
        messages: [
          { role: 'system', content: req.systemInstruction },
          ...req.messages,
        ],
        formatJson: req.formatJson,
        maxOutputTokens: req.maxOutputTokens,
        timeoutMs: req.timeoutMs,
        onToken: req.onToken,
      });
      return {
        text: result.text,
        provider: 'ollama',
        model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        tokensMeasured: result.tokensMeasured,
        latencyMs: result.latencyMs,
      };
    }

    if (connection.provider === 'gemini') {
      const apiKey = resolveApiKey(connection);
      if (!apiKey) {
        throw new Error(
          'Legacy Gemini connection selected, but no Gemini API key is configured. Switch the chatbot to Local Ollama in AI Models.'
        );
      }
      const last = req.messages[req.messages.length - 1];
      const history = req.messages.slice(0, -1);
      try {
        const reply = await generateGeminiChatbotReply({
          apiKey,
          model: model || 'gemini-3.1-flash-lite',
          systemInstruction: req.systemInstruction,
          history,
          userMessage: last?.content || '',
          formatJson: req.formatJson,
          maxOutputTokens: req.maxOutputTokens,
        });
        if (req.onToken && reply.text) {
          req.onToken(reply.text);
        }
        return {
          text: reply.text,
          provider: 'gemini',
          model: model || 'gemini-3.1-flash-lite',
          inputTokens: reply.inputTokens,
          outputTokens: reply.outputTokens,
          tokensMeasured: true,
          latencyMs: reply.latencyMs,
        };
      } catch (err: unknown) {
        throw new Error(formatGeminiError(err instanceof Error ? err.message : String(err)));
      }
    }

    if (connection.provider === 'openai_compatible') {
      const base = (connection.endpoint || '').trim().replace(/\/+$/, '');
      if (!base) throw new Error('OpenAI-compatible endpoint URL missing.');
      const apiKey = resolveApiKey(connection);
      const started = Date.now();
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: req.systemInstruction },
            ...req.messages,
          ],
          ...(req.formatJson ? { response_format: { type: 'json_object' } } : {}),
          ...(req.maxOutputTokens ? { max_tokens: req.maxOutputTokens } : {}),
        }),
        signal: AbortSignal.timeout(req.timeoutMs ?? 60000),
      });
      if (!res.ok) {
        throw new Error(`Provider returned HTTP ${res.status}: ${(await res.text()).slice(0, 180)}`);
      }
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const text = (data.choices?.[0]?.message?.content ?? '').trim();
      if (req.onToken && text) req.onToken(text);
      return {
        text,
        provider: 'openai_compatible',
        model,
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
        tokensMeasured: Boolean(data.usage),
        latencyMs: Date.now() - started,
      };
    }

    throw new Error(`Unsupported LLM provider "${connection.provider}".`);
  },
};
