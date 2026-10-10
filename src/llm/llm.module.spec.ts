import { Test } from '@nestjs/testing';
import { LLM_CLIENT } from './llm-client.interface';
import { LlmModule } from './llm.module';
import { AppConfigService } from '../config/app-config.service';
import { MockLlmClient } from './mock-llm-client';
import { GenAiLlmClient } from './genai-llm-client';

describe('LlmModule provider factory', () => {
  it('provides MockLlmClient when effective mode is mock', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [LlmModule],
    })
      .overrideProvider(AppConfigService)
      .useValue({
        effectiveLlmMode: 'mock',
        geminiApiKey: '',
        geminiModel: 'gemini-3.8-flash',
      })
      .compile();

    const client = moduleRef.get(LLM_CLIENT);
    expect(client).toBeInstanceOf(MockLlmClient);
  });

  it('provides GenAiLlmClient when effective mode is live', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [LlmModule],
    })
      .overrideProvider(AppConfigService)
      .useValue({
        effectiveLlmMode: 'live',
        geminiApiKey: 'test-key',
        geminiModel: 'gemini-3.8-flash',
      })
      .compile();

    const client = moduleRef.get(LLM_CLIENT);
    expect(client).toBeInstanceOf(GenAiLlmClient);
  });
});
