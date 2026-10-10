import { Injectable } from '@nestjs/common';
import { MockVideoAnalyzer } from './analyzers/mock-video-analyzer';
import { VideoAnalysis } from './analyzers/analysis.schema';

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
    return {
      videoId: 'mock-id',
      title,
      channel,
      recipeName: title,
      ingredients: [{ name: 'olive oil' }, { name: 'vegetables' }],
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
      status: 'ok',
      provider: 'mock',
      model: 'mock',
      analyzedAt: new Date().toISOString(),
      schemaVersion: 2,
      transcript: `Mock transcript for ${title}`,
      detectedAllergens: title.toLowerCase().includes('peanut')
        ? ['peanuts']
        : [],
    };
  }
}
