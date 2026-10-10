/**
 * Thin, provider-agnostic contract over the Gemini Interactions API.
 *
 * Everything above this layer (video analyzer, agent loop) talks to
 * `LlmClient`, so tests can inject a scripted fake and a future switch to
 * `models.generateContent` (or another provider) touches one file.
 */

export const LLM_CLIENT = Symbol('LLM_CLIENT');

/** A step as returned by / sent to the Interactions API (kept opaque on purpose). */
export type LlmStep = { type: string; [k: string]: any };

export type LlmContent =
  | { type: 'text'; text: string }
  | { type: 'video'; uri: string; resolution?: string };

export interface LlmFunctionTool {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, any>;
}

export interface LlmToolChoice {
  mode: 'auto' | 'any' | 'none' | 'validated';
  allowedTools?: string[];
}

export interface LlmRequest {
  model: string;
  systemInstruction?: string;
  /** Plain text, a list of content parts (single user turn) or full step history. */
  input: string | LlmContent[] | LlmStep[];
  tools?: LlmFunctionTool[];
  toolChoice?: LlmToolChoice;
  /** JSON Schema for the final text answer (structured output). */
  responseSchema?: Record<string, any>;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
}

export interface LlmFunctionCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface LlmUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface LlmResponse {
  id?: string;
  status?: string;
  /** Steps produced by the model in this turn (thought, function_call, model_output…). */
  steps: LlmStep[];
  text: string;
  functionCalls: LlmFunctionCall[];
  usage?: LlmUsage;
}

export interface LlmClient {
  create(req: LlmRequest): Promise<LlmResponse>;
}

export type LlmErrorCode =
  | 'not_configured'
  | 'rate_limited'
  | 'timeout'
  | 'video_not_accessible'
  | 'bad_request'
  | 'unavailable'
  | 'bad_response'
  | 'unknown';

export class LlmError extends Error {
  constructor(
    public readonly code: LlmErrorCode,
    message: string,
    public readonly status?: number,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

/** Build a function_result step for the next turn. */
export function functionResultStep(call: LlmFunctionCall, result: unknown, isError = false): LlmStep {
  return {
    type: 'function_result',
    call_id: call.id,
    name: call.name,
    is_error: isError || undefined,
    result: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result) }],
  };
}

/** Build a user_input step from text. */
export function userInputStep(text: string): LlmStep {
  return { type: 'user_input', content: [{ type: 'text', text }] };
}
