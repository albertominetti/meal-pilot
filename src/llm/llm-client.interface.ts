export interface InteractionTool {
  type: 'function';
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
}

export interface InteractionResponseFormat {
  type: 'text';
  mime_type: 'application/json' | 'text/plain';
  schema?: Record<string, unknown>;
}

export interface InteractionStep {
  type: string;
  id?: string;
  name?: string;
  arguments?: Record<string, unknown>;
  signature?: string;
  content?: Array<{ type: string; text?: string; uri?: string; [k: string]: unknown }>;
  result?: unknown;
  call_id?: string;
  is_error?: boolean;
  [k: string]: unknown;
}

export interface InteractionRequest {
  model?: string;
  system_instruction?: string;
  input: string | InteractionStep[];
  tools?: InteractionTool[];
  response_format?: InteractionResponseFormat;
  store?: boolean;
}

export interface InteractionUsage {
  totalTokens?: number;
  totalInputTokens?: number;
  totalOutputTokens?: number;
}

export interface InteractionResult {
  outputText: string;
  steps: InteractionStep[];
  usage?: InteractionUsage;
  raw?: unknown;
}

export interface LlmClient {
  createInteraction(req: InteractionRequest): Promise<InteractionResult>;
}

export const LLM_CLIENT = Symbol('LLM_CLIENT');
