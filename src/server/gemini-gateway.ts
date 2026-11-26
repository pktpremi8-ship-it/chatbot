import { GoogleGenAI, type Content } from '@google/genai';

function createGeminiClient(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export interface GeminiTestResult {
  ok: boolean;
  model: string;
  latencyMs: number;
  message: string;
}

export async function testGeminiConnection(params: {
  apiKey: string;
  model: string;
}): Promise<GeminiTestResult> {
  const started = Date.now();
  const targetModel = (params.model || 'gemini-3.1-flash-lite').trim();
  const ai = createGeminiClient(params.apiKey);

  const runProbe = async (modelId: string) => {
    const response = await ai.models.generateContent({
      model: modelId,
      contents: 'Reply with exactly: OK',
    });
    const latencyMs = Date.now() - started;
    const text = (response.text ?? '').trim();
    return {
      ok: true,
      model: modelId,
      latencyMs,
      message: text ? `Verified response (${latencyMs}ms): "${text.slice(0, 60)}"` : `Connected (${latencyMs}ms)`,
    };
  };

  try {
    return await runProbe(targetModel);
  } catch (err: unknown) {
    const raw = err instanceof Error ? err.message : String(err);
    const lower = raw.toLowerCase();
    const isDemand =
      lower.includes('503') || lower.includes('unavailable') || lower.includes('high demand');
    if (isDemand && targetModel !== 'gemini-3.1-flash-lite') {
      try {
        return await runProbe('gemini-3.1-flash-lite');
      } catch (fallbackErr: unknown) {
        const fbRaw = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
        return {
          ok: false,
          model: 'gemini-3.1-flash-lite',
          latencyMs: Date.now() - started,
          message: formatGeminiError(fbRaw),
        };
      }
    }
    return {
      ok: false,
      model: targetModel,
      latencyMs: Date.now() - started,
      message: formatGeminiError(raw),
    };
  }
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface GeminiChatResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

async function withTransientRetry<T>(fn: () => Promise<T>, maxAttempts = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;
      const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
      const isTransient =
        msg.includes('503') ||
        msg.includes('unavailable') ||
        msg.includes('high demand') ||
        msg.includes('temporarily');
      if (!isTransient || attempt === maxAttempts) {
        throw err;
      }
      const delayMs = 450 * Math.pow(2, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

export async function generateGeminiChatbotReply(params: {
  apiKey: string;
  model: string;
  systemInstruction: string;
  history: ChatTurn[];
  userMessage: string;
  formatJson?: boolean;
  maxOutputTokens?: number;
}): Promise<GeminiChatResult> {
  const started = Date.now();
  const ai = createGeminiClient(params.apiKey);

  const contents: Content[] = params.history.slice(-16).map((turn) => ({
    role: turn.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: turn.content }],
  }));
  contents.push({
    role: 'user',
    parts: [{ text: params.userMessage }],
  });

  const callModel = (targetModel: string, attempts = 2) =>
    withTransientRetry(
      () =>
        ai.models.generateContent({
          model: targetModel,
          contents,
          config: {
            systemInstruction: params.systemInstruction,
            ...(params.formatJson ? { responseMimeType: 'application/json' } : {}),
            ...(params.maxOutputTokens && params.maxOutputTokens > 0
              ? { maxOutputTokens: params.maxOutputTokens }
              : {}),
          },
        }),
      attempts
    );

  let response;
  const primaryModel = (params.model || 'gemini-3.1-flash-lite').trim();
  try {
    response = await callModel(
      primaryModel,
      primaryModel === 'gemini-3.1-flash-lite' ? 2 : 1
    );
  } catch (err: unknown) {
    const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
    const isDemand =
      msg.includes('503') || msg.includes('unavailable') || msg.includes('high demand');
    if (isDemand && primaryModel !== 'gemini-3.1-flash-lite') {
      response = await callModel('gemini-3.1-flash-lite', 2);
    } else {
      throw err;
    }
  }

  const latencyMs = Date.now() - started;
  const text = (response.text ?? '').trim();
  const usage = response.usageMetadata;

  return {
    text: text || 'I could not generate a response for that message. Please try rephrasing.',
    inputTokens: usage?.promptTokenCount ?? 0,
    outputTokens: usage?.candidatesTokenCount ?? 0,
    latencyMs,
  };
}

export function formatGeminiError(message: string): string {
  let cleanMessage = message;
  try {
    const parsed = JSON.parse(message);
    if (typeof parsed?.error?.message === 'string') {
      cleanMessage = parsed.error.message;
    }
  } catch {
    // not raw JSON
  }

  if (cleanMessage.includes('API_KEY_INVALID') || cleanMessage.includes('400')) {
    return 'Gemini rejected the API key or request format. Verify the API key and selected model.';
  }
  if (cleanMessage.includes('PERMISSION_DENIED') || cleanMessage.includes('403')) {
    return 'Permission denied by Gemini API. Check that your API key is active in Settings > Secrets or BYOK credentials.';
  }
  if (cleanMessage.includes('RESOURCE_EXHAUSTED') || cleanMessage.includes('429')) {
    return 'Rate limit or quota exceeded (429). Try again shortly or switch to a billing-enabled key.';
  }
  if (cleanMessage.includes('NOT_FOUND') || cleanMessage.includes('404')) {
    return 'Selected Gemini model was not found. Choose an active model such as gemini-4-hydrogen.';
  }
  return cleanMessage || 'Gemini provider request failed.';
}
