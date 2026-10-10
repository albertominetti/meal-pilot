import { GeminiVideoAnalyzer } from './gemini-video-analyzer';
import { LlmClient, InteractionRequest, InteractionResult } from '../../llm/llm-client.interface';
import { AppConfigService } from '../../config/app-config.service';

class FakeLlmClient implements LlmClient {
  public requests: InteractionRequest[] = [];
  public responses: InteractionResult[] = [];
  public shouldThrow: Error | null = null;

  async createInteraction(req: InteractionRequest): Promise<InteractionResult> {
    this.requests.push(req);
    if (this.shouldThrow) {
      throw this.shouldThrow;
    }
    if (this.responses.length > 0) {
      return this.responses.shift()!;
    }
    throw new Error('No fake response queued');
  }
}

describe('GeminiVideoAnalyzer', () => {
  let fakeLlm: FakeLlmClient;
  let mockConfig: Partial<AppConfigService>;
  let analyzer: GeminiVideoAnalyzer;

  beforeEach(() => {
    fakeLlm = new FakeLlmClient();
    mockConfig = {
      geminiModel: 'gemini-3.8-flash',
    };
    analyzer = new GeminiVideoAnalyzer(fakeLlm as any, mockConfig as any);
  });

  it('successfully parses valid structured JSON output on first attempt', async () => {
    fakeLlm.responses.push({
      outputText: JSON.stringify({
        recipeName: 'Vegan Lentil Soup',
        servings: 4,
        ingredients: [{ name: 'brown lentils' }, { name: 'carrots' }],
        steps: ['Chop vegetables', 'Simmer lentils'],
        allergens: [],
        crossContactNotes: [],
        sodiumSources: ['sea salt'],
        nutritionSignals: ['low-sodium'],
        restrictionTags: ['vegan', 'gluten-free'],
        summary: 'Healthy lentil soup',
        coverage: 'full',
      }),
      steps: [],
    });

    const result = await analyzer.analyze({
      videoId: 'v123',
      title: 'Vegan Lentil Soup',
      channel: 'Chef Ana',
    });

    expect(result.status).toBe('ok');
    expect(result.recipeName).toBe('Vegan Lentil Soup');
    expect(result.provider).toBe('gemini');
    expect(fakeLlm.requests.length).toBe(1);
  });

  it('retries once when schema validation fails and succeeds on second attempt', async () => {
    // 1st attempt: invalid JSON or missing required fields
    fakeLlm.responses.push({
      outputText: JSON.stringify({
        recipeName: 'Incomplete Soup',
        // missing ingredients, steps, allergens, etc.
      }),
      steps: [],
    });

    // 2nd attempt: valid
    fakeLlm.responses.push({
      outputText: JSON.stringify({
        recipeName: 'Complete Soup',
        ingredients: [{ name: 'lentils' }],
        steps: ['Cook'],
        allergens: [],
        crossContactNotes: [],
        sodiumSources: [],
        nutritionSignals: ['whole-foods'],
        restrictionTags: ['vegetarian'],
        summary: 'Complete soup recipe',
        coverage: 'full',
      }),
      steps: [],
    });

    const result = await analyzer.analyze({
      videoId: 'v123',
      title: 'Soup',
      channel: 'Chef',
    });

    expect(result.status).toBe('ok');
    expect(result.recipeName).toBe('Complete Soup');
    expect(fakeLlm.requests.length).toBe(2);
  });

  it('marks video as unavailable when LLM throws an error', async () => {
    fakeLlm.shouldThrow = new Error('404 video not found or private');

    const result = await analyzer.analyze({
      videoId: 'v123',
      title: 'Private Video',
      channel: 'Secret',
    });

    expect(result.status).toBe('unavailable');
    expect(result.error).toBe('video_not_public');
  });
});
