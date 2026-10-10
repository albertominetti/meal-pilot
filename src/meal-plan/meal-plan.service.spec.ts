import { Test } from '@nestjs/testing';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MealPlanService } from './meal-plan.service';
import { TranscriptCacheService } from '../videos/transcript-cache.service';
import { VideoAnalysisService } from '../videos/video-analysis.service';
import { VIDEO_ANALYZER } from '../videos/analyzers/video-analyzer.interface';
import { MockVideoAnalyzer } from '../videos/analyzers/mock-video-analyzer';
import { AppConfigService } from '../config/app-config.service';
import { FakeYouTubeService } from '../youtube/fake-youtube.service';
import { YOUTUBE_SERVICE } from '../youtube/youtube.interface';

async function buildService() {
  process.env.MEALPILOT_CACHE_DIR = fs.mkdtempSync(
    path.join(os.tmpdir(), 'mealpilot-plan-'),
  );

  const mockConfig = {
    effectiveLlmMode: 'mock' as const,
    geminiModel: 'gemini-3.8-flash',
  };

  const moduleRef = await Test.createTestingModule({
    providers: [
      MealPlanService,
      TranscriptCacheService,
      VideoAnalysisService,
      MockVideoAnalyzer,
      {
        provide: VIDEO_ANALYZER,
        useClass: MockVideoAnalyzer,
      },
      {
        provide: AppConfigService,
        useValue: mockConfig,
      },
      {
        provide: YOUTUBE_SERVICE,
        useClass: FakeYouTubeService,
      },
    ],
  }).compile();

  return moduleRef.get(MealPlanService);
}

describe('MealPlanService table-driven safety rules', () => {
  it('blocks videos with detected allergen matches and lists them under excluded', async () => {
    delete process.env.GEMINI_API_KEY;
    const svc = await buildService();
    const res = await svc.buildPlan({
      healthProfile: 'hypertension',
      bloodPressure: '140/90',
      restrictions: ['vegetarian'],
      allergies: ['peanuts'],
      videoCandidates: [
        {
          idOrUrl: 'dQw4w9WgXcQ',
          title: 'Peanut Satay Noodles',
          channel: 'Wok House',
        },
        {
          idOrUrl: 'abcdefghijk',
          title: 'Low-Sodium Vegetarian Lentil Soup',
          channel: 'Healthy Kitchen',
        },
      ],
      maxResults: 5,
    } as any);

    expect(res.disclaimer).toMatch(/not medical advice/i);
    expect(res.excluded.length).toBeGreaterThanOrEqual(1);
    expect(res.excluded[0].reason).toMatch(/blocked|review/i);
    expect(res.meta).toBeDefined();
    expect(res.meta?.mode).toBe('mock');
    for (const r of res.recommendations) {
      expect(r.allergySafety.status).toBe('safe');
    }
  });

  it('evaluates table-driven allergy safety rules correctly', async () => {
    const svc = await buildService();

    // 1. Unavailable -> uncertain
    const unavailableVerdict = svc.evaluateAllergySafety(
      {
        status: 'unavailable',
        error: 'video_not_public',
      } as any,
      ['peanuts'],
    );
    expect(unavailableVerdict.status).toBe('uncertain');

    // 2. Confirmed allergen -> unsafe
    const confirmedVerdict = svc.evaluateAllergySafety(
      {
        status: 'ok',
        allergens: [
          {
            allergen: 'peanuts',
            evidence: 'Added peanut butter',
            confidence: 'confirmed',
          },
        ],
      } as any,
      ['peanuts'],
    );
    expect(confirmedVerdict.status).toBe('unsafe');

    // 3. Possible allergen -> uncertain
    const possibleVerdict = svc.evaluateAllergySafety(
      {
        status: 'ok',
        allergens: [
          {
            allergen: 'peanuts',
            evidence: 'Unlabeled mystery nut sauce',
            confidence: 'possible',
          },
        ],
      } as any,
      ['peanuts'],
    );
    expect(possibleVerdict.status).toBe('uncertain');

    // 4. Cross-contact notes -> uncertain
    const crossVerdict = svc.evaluateAllergySafety(
      {
        status: 'ok',
        allergens: [],
        crossContactNotes: ['Made on equipment shared with shrimp'],
      } as any,
      ['shellfish'],
    );
    expect(crossVerdict.status).toBe('uncertain');

    // 5. Ingredient text alias match -> unsafe
    const aliasVerdict = svc.evaluateAllergySafety(
      {
        status: 'ok',
        allergens: [],
        crossContactNotes: [],
        ingredients: [{ name: 'groundnut oil' }],
        steps: ['Fry in groundnut oil'],
      } as any,
      ['peanuts'],
    );
    expect(aliasVerdict.status).toBe('unsafe');

    // 6. Partial coverage + severe allergy -> uncertain
    const partialVerdict = svc.evaluateAllergySafety(
      {
        status: 'ok',
        allergens: [],
        crossContactNotes: [],
        ingredients: [{ name: 'lentils' }],
        steps: ['Boil'],
        coverage: 'partial',
      } as any,
      ['peanuts'],
    );
    expect(partialVerdict.status).toBe('uncertain');

    // 7. Safe dish
    const safeVerdict = svc.evaluateAllergySafety(
      {
        status: 'ok',
        allergens: [],
        crossContactNotes: [],
        ingredients: [{ name: 'lentils' }, { name: 'carrots' }],
        steps: ['Boil with water'],
        coverage: 'full',
      } as any,
      ['peanuts'],
    );
    expect(safeVerdict.status).toBe('safe');
  });
});
