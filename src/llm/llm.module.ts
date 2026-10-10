import { Module, Provider } from '@nestjs/common';
import { AppConfigModule } from '../config/config.module';
import { AppConfigService } from '../config/app-config.service';
import { LLM_CLIENT, LlmClient } from './llm-client.interface';
import { GenAiLlmClient } from './genai-llm-client';
import { MockLlmClient } from './mock-llm-client';

const llmClientProvider: Provider = {
  provide: LLM_CLIENT,
  useFactory: (config: AppConfigService): LlmClient => {
    if (config.effectiveLlmMode === 'live') {
      return new GenAiLlmClient(config);
    }
    return new MockLlmClient();
  },
  inject: [AppConfigService],
};

@Module({
  imports: [AppConfigModule],
  providers: [llmClientProvider, GenAiLlmClient, MockLlmClient],
  exports: [LLM_CLIENT, GenAiLlmClient, MockLlmClient],
})
export class LlmModule {}
