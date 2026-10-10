import {
  buildAnalysisPrompt,
  GeminiVideoAnalyzer,
  MAX_DESCRIPTION_CHARS,
} from './gemini-video-analyzer';
import { LlmClient, InteractionRequest, InteractionResult } from '../../llm/llm-client.interface';
import { AppConfigService } from '../../config/app-config.service';

function v3Ingredient(name: string, extra: Record<string, unknown> = {}) {
  return {
    name,
    quantity: 200,
    unit: 'g',
    rawText: `200g ${name}`,
    confidence: 'high',
    source: 'video',
    packaged: false,
    ...extra,
  };
}

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
        prepMinutes: 40,
        mainProtein: 'lentil',
        cuisine: 'european',
        mealType: ['lunch', 'dinner'],
        ingredients: [
          v3Ingredient('brown lentil', { source: 'description' }),
          v3Ingredient('carrot'),
          v3Ingredient('vegetable stock', {
            quantity: 1,
            unit: 'l',
            packaged: true,
            source: 'both',
          }),
        ],
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
    expect(result.prepMinutes).toBe(40);
    expect(result.ingredients[0]).toMatchObject({
      quantity: 200,
      unit: 'g',
      source: 'description',
    });
    expect(result.labelCheck).toEqual(['vegetable stock']);
    expect(result.nutritionSignalsSource).toBe('model');
    expect(result.schemaVersion).toBe(3);
    expect(fakeLlm.requests.length).toBe(1);
  });

  it('rejects v2-style ingredients without quantity fields and retries', async () => {
    const v2 = {
      recipeName: 'Old',
      ingredients: [{ name: 'lentils', quantity: '1 cup' }],
      steps: ['Cook'],
      allergens: [],
      summary: 'old shape',
    };
    fakeLlm.responses.push({ outputText: JSON.stringify(v2), steps: [] });
    fakeLlm.responses.push({ outputText: JSON.stringify(v2), steps: [] });

    const result = await analyzer.analyze({ videoId: 'v1', title: 'Old', channel: 'C' });
    expect(result.status).toBe('unavailable');
    expect(fakeLlm.requests.length).toBe(2);
  });

  it('sends the description to Gemini as tagged untrusted data', async () => {
    fakeLlm.responses.push({
      outputText: JSON.stringify({
        recipeName: 'Curry',
        ingredients: [v3Ingredient('tofu')],
        steps: ['Cook'],
        allergens: [],
        summary: 'Curry',
      }),
      steps: [],
    });

    await analyzer.analyze({
      videoId: 'v9',
      title: 'Curry',
      channel: 'Chef',
      description: 'Ingredients: 400g tofu, 2 tbsp peanut sauce',
    });

    const content = (fakeLlm.requests[0].input as any)[0].content;
    const text = content.find((c: any) => c.type === 'text').text as string;
    expect(text).toContain('<video_description>\nIngredients: 400g tofu, 2 tbsp peanut sauce\n</video_description>');
    expect(text).toMatch(/UNTRUSTED DATA/);
    expect(text).toMatch(/Prefer exact quantities from the description/);
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
        ingredients: [v3Ingredient('lentil')],
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

describe('buildAnalysisPrompt', () => {
  it('omits the description block when there is no description', () => {
    const text = buildAnalysisPrompt({ videoId: 'v', title: 'T', channel: 'C' });
    expect(text).not.toContain('<video_description>');
  });

  it('strips control characters and truncates long descriptions', () => {
    const long = `\u0007start ${'x'.repeat(MAX_DESCRIPTION_CHARS + 500)}`;
    const text = buildAnalysisPrompt({
      videoId: 'v',
      title: 'T',
      channel: 'C',
      description: long,
    });
    const body = text.split('<video_description>\n')[1].split('\n</video_description>')[0];
    expect(body.startsWith('start')).toBe(true);
    expect(body.length).toBeLessThanOrEqual(MAX_DESCRIPTION_CHARS + 1);
  });
});
