import { Logger } from '@nestjs/common';
import type { GoogleGenAI } from '@google/genai';
import {
  LlmClient,
  LlmError,
  LlmFunctionCall,
  LlmRequest,
  LlmResponse,
  LlmStep,
} from './llm-client';

const MAX_RETRIES = 2;
const BACKOFF_MS = [1000, 3000];

/**
 * Gemini Interactions API client (`@google/genai` >= 2.3).
 *
 * - `store: false`: health profiles are not retained server-side; the agent
 *   loop resends the full step history (incl. thought steps) every turn.
 * - Retries 429/5xx/timeouts with backoff; everything else fails fast.
 */
export class GenAiLlmClient implements LlmClient {
  private readonly logger = new Logger(GenAiLlmClient.name);
  private clientPromise?: Promise<GoogleGenAI>;

  constructor(
    private readonly apiKey: string,
    private readonly defaultTimeoutMs = 120_000,
    /** Extra GoogleGenAI options (e.g. httpOptions.baseUrl for a proxy or tests). */
    private readonly clientOptions: Record<string, any> = {},
  ) {}

  private client(): Promise<GoogleGenAI> {
    if (!this.clientPromise) {
      this.clientPromise = import('@google/genai').then(
        ({ GoogleGenAI }) => new GoogleGenAI({ ...this.clientOptions, apiKey: this.apiKey }),
      );
    }
    return this.clientPromise;
  }

  async create(req: LlmRequest): Promise<LlmResponse> {
    let lastErr: LlmError | undefined;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await this.once(req);
      } catch (err) {
        lastErr = toLlmError(err);
        if (!lastErr.retryable || attempt === MAX_RETRIES) throw lastErr;
        const wait = BACKOFF_MS[attempt] ?? 3000;
        this.logger.warn(`Gemini ${lastErr.code} (${lastErr.status ?? '-'}), retrying in ${wait}ms`);
        await sleep(wait);
      }
    }
    throw lastErr ?? new LlmError('unknown', 'unreachable');
  }

  private async once(req: LlmRequest): Promise<LlmResponse> {
    const ai = await this.client();
    const params: Record<string, any> = {
      model: req.model,
      input: req.input,
      store: false,
    };
    if (req.systemInstruction) params.system_instruction = req.systemInstruction;
    if (req.tools?.length) params.tools = req.tools;
    if (req.responseSchema) {
      params.response_format = {
        type: 'text',
        mime_type: 'application/json',
        schema: req.responseSchema,
      };
    }
    const gen: Record<string, any> = {};
    if (req.temperature !== undefined) gen.temperature = req.temperature;
    if (req.maxOutputTokens !== undefined) gen.max_output_tokens = req.maxOutputTokens;
    if (req.toolChoice) {
      gen.tool_choice = req.toolChoice.allowedTools?.length
        ? { allowed_tools: { mode: req.toolChoice.mode, tools: req.toolChoice.allowedTools } }
        : req.toolChoice.mode;
    }
    if (Object.keys(gen).length) params.generation_config = gen;

    const timeoutMs = req.timeoutMs ?? this.defaultTimeoutMs;
    const res: any = await withTimeout(
      ai.interactions.create(params as any),
      timeoutMs,
    );
    return normalizeInteraction(res);
  }
}

/** Exported for unit tests. */
export function normalizeInteraction(res: any): LlmResponse {
  const steps: LlmStep[] = Array.isArray(res?.steps)
    ? res.steps.filter((s: LlmStep) => s && s.type !== 'user_input' && s.type !== 'function_result')
    : [];
  const functionCalls: LlmFunctionCall[] = steps
    .filter((s) => s.type === 'function_call')
    .map((s) => ({ id: String(s.id), name: String(s.name), arguments: s.arguments ?? {} }));

  let text: string = typeof res?.output_text === 'string' ? res.output_text : '';
  if (!text) {
    text = steps
      .filter((s) => s.type === 'model_output')
      .flatMap((s) => (Array.isArray(s.content) ? s.content : []))
      .filter((c: any) => c?.type === 'text' && typeof c.text === 'string')
      .map((c: any) => c.text)
      .join('');
  }
  const failed = steps.find((s) => s.type === 'model_output' && s.error);
  if (failed && !text && functionCalls.length === 0) {
    throw new LlmError('bad_response', `Model returned error: ${JSON.stringify(failed.error)}`);
  }
  const u = res?.usage ?? {};
  return {
    id: res?.id,
    status: res?.status,
    steps,
    text,
    functionCalls,
    usage: {
      inputTokens: u.total_input_tokens,
      outputTokens: u.total_output_tokens,
      totalTokens: u.total_tokens,
    },
  };
}

export function toLlmError(err: unknown): LlmError {
  if (err instanceof LlmError) return err;
  const e = err as any;
  const status: number | undefined =
    e?.status ?? e?.statusCode ?? e?.httpMeta?.response?.status ?? e?.response?.status;
  const msg = String(e?.message ?? e ?? 'unknown error');
  if (/video|youtube/i.test(msg) && /(private|unlisted|not (be )?accessible|unavailable|not found|permission)/i.test(msg)) {
    return new LlmError('video_not_accessible', msg, status, false);
  }
  if (status === 429) return new LlmError('rate_limited', msg, status, true);
  if (status && status >= 500) return new LlmError('unavailable', msg, status, true);
  if (status && status >= 400) return new LlmError('bad_request', msg, status, false);
  if (/timeout|timed out|ETIMEDOUT|ECONNRESET|fetch failed/i.test(msg)) {
    return new LlmError('timeout', msg, status, true);
  }
  return new LlmError('unknown', msg, status, false);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: NodeJS.Timeout;
  return Promise.race([
    p.finally(() => clearTimeout(t)),
    new Promise<T>((_, reject) => {
      t = setTimeout(() => reject(new LlmError('timeout', `Gemini call exceeded ${ms}ms`, undefined, true)), ms);
    }),
  ]);
}
