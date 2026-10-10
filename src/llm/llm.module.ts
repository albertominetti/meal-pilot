import { Global, Logger, Module } from '@nestjs/common';
import { AppConfig } from '../config/app-config.service';
import { GenAiLlmClient } from './genai-llm-client';
import { LLM_CLIENT, LlmClient, LlmError } from './llm-client';

/** Used in mock mode: any accidental live call fails loudly instead of silently. */
export class DisabledLlmClient implements LlmClient {
  async create(): Promise<never> {
    throw new LlmError('not_configured', 'Gemini is disabled (MEALPILOT_LLM_MODE=mock or no GEMINI_API_KEY)');
  }
}

@Global()
@Module({
  providers: [
    {
      provide: LLM_CLIENT,
      inject: [AppConfig],
      useFactory: (config: AppConfig): LlmClient => {
        const logger = new Logger('LlmModule');
        if (config.llmMode === 'live' && config.geminiApiKey) {
          logger.log(`Gemini live mode (agent=${config.geminiModel}, analysis=${config.analysisModel})`);
          return new GenAiLlmClient(config.geminiApiKey, config.llmTimeoutMs);
        }
        logger.log('LLM mock mode: deterministic offline analysis, agent uses fallback planner');
        return new DisabledLlmClient();
      },
    },
  ],
  exports: [LLM_CLIENT],
})
export class LlmModule {}
