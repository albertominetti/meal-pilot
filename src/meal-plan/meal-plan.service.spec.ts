import { LlmError } from '../llm/llm-client';
import { FakeYouTube, ScriptedLlmClient, buildTestingModule, okAnalysisJson, ytVideo } from '../../test/fakes';
import { MealPlanService } from './meal-plan.service';

const text = (t: string) => ({ steps: [], text: t, functionCalls: [] });

describe('MealPlanService', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  describe('mock mode (offline)', () => {
    beforeEach(() => {
      process.env.MEALPILOT_LLM_MODE = 'mock';
    });

    it('blocks videos with detected allergen matches and lists them under excluded', async () => {
      const svc = (await buildTestingModule()).get(MealPlanService);
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
      expect(res.excluded.find((e) => e.videoId === 'dQw4w9WgXcQ')?.reason).toMatch(/^Blocked/);
      // Mock cannot prove absence of a severe allergen -> needs review, not safe.
      expect(res.excluded.find((e) => e.videoId === 'abcdefghijk')?.reason).toMatch(/^Needs review/);
      expect(res.recommendations).toEqual([]);
      expect(res.meta).toMatchObject({ mode: 'mock', provider: 'mock', analyzed: 2 });
    });

    it('recommends when no allergies are declared and falls back to the seed list', async () => {
      const svc = (await buildTestingModule()).get(MealPlanService);
      const res = await svc.buildPlan({ maxResults: 2, restrictions: ['vegan'] } as any);
      expect(res.recommendations.length).toBe(2);
      for (const r of res.recommendations) expect(r.allergySafety.status).toBe('safe');
    });
  });

  describe('live mode', () => {
    beforeEach(() => {
      process.env.MEALPILOT_LLM_MODE = 'live';
      process.env.GEMINI_API_KEY = 'test';
    });

    it('a failed Gemini call excludes the video instead of using mock data', async () => {
      const llm = new ScriptedLlmClient([new LlmError('unavailable', 'down', 503, true)]);
      const svc = (await buildTestingModule({ llm })).get(MealPlanService);
      const res = await svc.buildPlan({
        allergies: ['peanuts'],
        videoCandidates: [{ idOrUrl: 'abcdefghijk', title: 'Totally Safe Salad' }],
      } as any);
      expect(res.recommendations).toEqual([]);
      expect(res.excluded[0].reason).toMatch(/could not be analyzed/);
      expect(res.meta.failures).toEqual([{ videoId: 'abcdefghijk', error: 'unavailable' }]);
      expect(res.meta.provider).toBe('gemini');
    });

    it('uses real analysis + caches it; second request is served from cache', async () => {
      const llm = new ScriptedLlmClient([text(okAnalysisJson())]);
      const moduleRef = await buildTestingModule({ llm });
      const svc = moduleRef.get(MealPlanService);
      const dto = { allergies: ['peanuts'], restrictions: ['vegan'], videoCandidates: [{ idOrUrl: 'abcdefghijk' }] } as any;
      const first = await svc.buildPlan(dto);
      expect(first.recommendations[0]).toMatchObject({ videoId: 'abcdefghijk', provider: 'gemini' });
      expect(first.recommendations[0].matchedTags).toContain('vegan');
      const second = await svc.buildPlan(dto);
      expect(second.meta.fromCache).toBe(1);
      expect(llm.requests).toHaveLength(1);
    });

    it('without candidates: searches YouTube with a profile-derived query, or rejects if search is off', async () => {
      const youtube = new FakeYouTube([ytVideo('abcdefghijk', 'Vegan Soup')]);
      const llm = new ScriptedLlmClient([text(okAnalysisJson())]);
      const svc = (await buildTestingModule({ llm, youtube })).get(MealPlanService);
      const res = await svc.buildPlan({ restrictions: ['vegan'], bloodPressure: '150/95', maxResults: 1 } as any);
      expect(youtube.searches[0]).toBe('vegan low sodium healthy recipe');
      expect(res.recommendations[0].videoId).toBe('abcdefghijk');

      const noSearch = (await buildTestingModule({ llm, youtube: new FakeYouTube([], false) })).get(MealPlanService);
      await expect(noSearch.buildPlan({} as any)).rejects.toThrow(/videoCandidates/);
    });

    it('enriches candidates with YouTube metadata and drops non-public videos', async () => {
      const llm = new ScriptedLlmClient([text(okAnalysisJson())]);
      const youtube = new FakeYouTube([
        ytVideo('abcdefghijk', 'Real Title'),
        ytVideo('privatevid1', 'Private', { privacyStatus: 'private' }),
      ]);
      const svc = (await buildTestingModule({ llm, youtube })).get(MealPlanService);
      const res = await svc.buildPlan({
        videoCandidates: [{ idOrUrl: 'abcdefghijk', title: 'caller title' }, { idOrUrl: 'privatevid1' }],
      } as any);
      expect(res.recommendations[0].title).toBe('Real Title');
      expect(res.excluded[0]).toMatchObject({ videoId: 'privatevid1' });
      expect(res.excluded[0].reason).toMatch(/not public/);
    });
  });
});
