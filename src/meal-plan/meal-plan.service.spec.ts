import { Test } from '@nestjs/testing';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MealPlanService } from './meal-plan.service';
import { TranscriptCacheService } from '../videos/transcript-cache.service';
import { VideoAnalysisService } from '../videos/video-analysis.service';
import { GeminiService } from '../videos/gemini.service';

async function buildService() {
  process.env.MEALPILOT_CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mealpilot-plan-'));
  const moduleRef = await Test.createTestingModule({
    providers: [MealPlanService, TranscriptCacheService, VideoAnalysisService, GeminiService],
  }).compile();
  return moduleRef.get(MealPlanService);
}

describe('MealPlanService allergy blocking (safety-critical)', () => {
  it('blocks videos with detected allergen matches and lists them under excluded', async () => {
    delete process.env.GEMINI_API_KEY;
    const svc = await buildService();
    const res = await svc.buildPlan({
      healthProfile: 'hypertension',
      bloodPressure: '140/90',
      restrictions: ['vegetarian'],
      allergies: ['peanuts'],
      videoCandidates: [
        { idOrUrl: 'dQw4w9WgXcQ', title: 'Peanut Satay Noodles', channel: 'Wok House' },
        { idOrUrl: 'abcdefghijk', title: 'Low-Sodium Vegetarian Lentil Soup', channel: 'Healthy Kitchen' },
      ],
      maxResults: 5,
    } as any);
    expect(res.disclaimer).toMatch(/not medical advice/i);
    expect(res.excluded.length).toBeGreaterThanOrEqual(1);
    expect(res.excluded[0].reason).toMatch(/blocked|review/i);
    for (const r of res.recommendations) {
      expect(r.allergySafety.status).toBe('safe');
    }
  });

  it('falls back to the seed list when no candidates are provided', async () => {
    delete process.env.GEMINI_API_KEY;
    const svc = await buildService();
    const res = await svc.buildPlan({ maxResults: 2 } as any);
    expect(res.recommendations.length + res.excluded.length).toBeGreaterThan(0);
  });
});
