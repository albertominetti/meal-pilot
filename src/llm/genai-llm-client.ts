import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';
import { AppConfigService } from '../config/app-config.service';
import {
  InteractionRequest,
  InteractionResult,
  InteractionStep,
  LlmClient,
} from './llm-client.interface';

function isRetryableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const status = (error as { status?: number; statusCode?: number }).status ??
    (error as { status?: number; statusCode?: number }).statusCode;

  if (typeof status === 'number' && (status === 429 || status >= 500)) {
    return true;
  }

  const message = String((error as { message?: string }).message || '').toLowerCase();
  return (
    message.includes('429') ||
    message.includes('resource_exhausted') ||
    message.includes('rate limit') ||
    message.includes('503') ||
    message.includes('unavailable') ||
    message.includes('timeout')
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

@Injectable()
export class GenAiLlmClient implements LlmClient {
  private readonly logger = new Logger(GenAiLlmClient.name);
  private readonly client: GoogleGenAI;

  constructor(private readonly config: AppConfigService) {
    this.client = new GoogleGenAI({
      apiKey: this.config.geminiApiKey || 'missing-key',
    });
  }

  async createInteraction(req: InteractionRequest): Promise<InteractionResult> {
    const model = req.model || this.config.geminiModel || 'gemini-3.8-flash';
    const maxRetries = 2;
    let attempt = 0;

    while (true) {
      try {
        const createParams: Record<string, unknown> = {
          model,
          input: req.input,
          store: req.store ?? false,
        };

        if (req.system_instruction) {
          createParams.system_instruction = req.system_instruction;
        }

        if (req.tools && req.tools.length > 0) {
          createParams.tools = req.tools;
        }

        if (req.response_format) {
          createParams.response_format = req.response_format;
        }

        const res = (await this.client.interactions.create(
          createParams as any,
        )) as any;

        const steps: InteractionStep[] = (res.steps || []).map((step: any) => ({
          ...step,
        }));

        const outputText =
          res.output_text ??
          steps
            .filter((s) => s.type === 'model_output' && Array.isArray(s.content))
            .flatMap((s) => (s.content as any[]) || [])
            .map((c) => c.text || '')
            .join('')
            .trim();

        return {
          outputText: outputText || '',
          steps,
          usage: res.usage
            ? {
                totalTokens: res.usage.total_tokens,
                totalInputTokens: res.usage.total_input_tokens,
                totalOutputTokens: res.usage.total_output_tokens,
              }
            : undefined,
          raw: res,
        };
      } catch (err) {
        attempt++;
        if (attempt <= maxRetries && isRetryableError(err)) {
          const backoff = 500 * Math.pow(2, attempt - 1);
          this.logger.warn(
            `Gemini request failed with retryable error (attempt ${attempt}/${maxRetries}), retrying in ${backoff}ms: ${err}`,
          );
          await delay(backoff);
          continue;
        }
        throw err;
      }
    }
  }
}
