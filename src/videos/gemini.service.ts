import { Injectable } from '@nestjs/common';
import { MockVideoAnalyzer } from './analyzers/mock-video-analyzer';
import {
  ANALYSIS_SCHEMA_VERSION,
  deriveLabelCheck,
  Ingredient,
  VideoAnalysis,
} from './analyzers/analysis.schema';

/**
 * Compatibility adapter for GeminiService.
 * Direct callers should migrate to VideoAnalysisService or VIDEO_ANALYZER.
 */
@Injectable()
export class GeminiService {
  private readonly mock = new MockVideoAnalyzer();

  isConfigured(): boolean {
    return Boolean(process.env.GEMINI_API_KEY);
  }

  provider(): 'gemini' | 'mock' {
    return this.isConfigured() ? 'gemini' : 'mock';
  }

  async analyzeVideo(
    videoId: string,
    title: string,
    channel: string,
  ): Promise<VideoAnalysis> {
    return this.mock.analyze({ videoId, title, channel });
  }

  mockAnalysis(title: string, channel: string): VideoAnalysis {
    const hay = `${title} ${channel}`.toLowerCase();
    const prepMinutes = /quick|15-minute|15 minute/.test(hay) ? 15 : 30;

    const ingredients: Ingredient[] = [
      {
        name: 'olive oil',
        quantity: 1,
        unit: 'tbsp',
        rawText: '1 tbsp olive oil',
        confidence: 'high',
        source: 'video',
        packaged: false,
      },
      {
        name: 'garlic',
        quantity: 2,
        unit: 'clove',
        rawText: '2 cloves minced garlic',
        confidence: 'high',
        source: 'video',
        packaged: false,
      },
      {
        name: 'vegetable broth',
        quantity: 500,
        unit: 'ml',
        rawText: '500ml vegetable broth',
        confidence: 'high',
        source: 'description',
        packaged: true,
      },
    ];

    return {
      videoId: 'mock-id',
      title,
      channel,
      recipeName: title,
      prepMinutes,
      mainProtein: 'none',
      cuisine: 'mediterranean',
      mealType: ['lunch', 'dinner'],
      ingredients,
      steps: ['Prepare ingredients', 'Cook and serve'],
      allergens: title.toLowerCase().includes('peanut')
        ? [
            {
              allergen: 'peanuts',
              evidence: 'Mock peanut match',
              confidence: 'confirmed',
            },
          ]
        : [],
      crossContactNotes: [],
      sodiumSources: [],
      nutritionSignals: ['whole-foods'],
      restrictionTags: title.toLowerCase().includes('vegan')
        ? ['vegan', 'vegetarian']
        : [],
      summary: `Mock analysis of ${title}`,
      coverage: 'full',
      labelCheck: deriveLabelCheck(ingredients),
      nutritionSignalsSource: 'model',
      status: 'ok',
      provider: 'mock',
      model: 'mock',
      analyzedAt: new Date().toISOString(),
      schemaVersion: ANALYSIS_SCHEMA_VERSION,
      transcript: `Mock transcript for ${title}`,
      detectedAllergens: title.toLowerCase().includes('peanut')
        ? ['peanuts']
        : [],
    };
  }
}
