import { ConflictException } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { analysis, ingredient } from '../../test/fixtures/analysis';
import { toRecipe } from '../meal-plan/recommendation.builder';
import { RecommendationDto } from '../meal-plan/dto/meal-plan-response.dto';
import { ProfilesService } from '../users/profiles.service';
import { FileUserDataStore } from '../users/user-data.store';
import { VideoAnalysis } from '../videos/analyzers/analysis.schema';
import { PlansService } from './plans.service';

function rec(a: VideoAnalysis): RecommendationDto {
  return {
    videoId: a.videoId,
    url: '',
    title: a.title,
    channel: a.channel,
    whyItFits: 'fits',
    matchedTags: [],
    allergySafety: { status: 'safe', notes: '' },
    healthNotes: '',
    labelCheck: [],
    trustedChannel: false,
    fitsTime: null,
    recipe: toRecipe(a),
    evidence: { goals: [], allergens: '', basis: 'none' },
  };
}

describe('PlansService.swap', () => {
  const peanutCurry = analysis({ videoId: 'cached', ingredients: [ingredient('peanut', 100, 'g')] });
  const current = analysis({ videoId: 'current', ingredients: [ingredient('lentil', 200, 'g')] });
  const fromAgent = analysis({ videoId: 'fresh', ingredients: [ingredient('rice', 150, 'g')] });

  function build(agentRecs: RecommendationDto[]) {
    process.env.MEALPILOT_CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mealpilot-plans-'));
    const store = new FileUserDataStore();
    const agent = { run: jest.fn().mockResolvedValue({ recommendations: agentRecs }) };
    const mealPlan = {
      evaluateAllergySafety: (a: VideoAnalysis) =>
        a.ingredients.some((i) => i.name === 'peanut')
          ? { status: 'unsafe' as const, notes: 'peanut' }
          : { status: 'safe' as const, notes: '' },
    };
    const svc = new PlansService(
      store,
      { list: async () => [peanutCurry, current] } as any,
      new ProfilesService(store),
      mealPlan as any,
      agent as any,
      { isTrusted: () => false } as any,
    );
    return { svc, store, agent };
  }

  async function savePlan(store: FileUserDataStore) {
    const now = new Date().toISOString();
    await store.createPlan({
      id: 'p1',
      userId: null,
      version: 1,
      request: { allergies: ['peanuts'], householdSize: 1 },
      items: [rec(current)],
      shoppingList: { householdSize: 1, sections: [], pantry: [], warnings: [] },
      checked: [],
      createdAt: now,
      updatedAt: now,
    });
  }

  it('falls back to a short single-slot agent run when no cached recipe is safe', async () => {
    const { svc, store, agent } = build([rec(fromAgent)]);
    await savePlan(store);

    const res = await svc.swap('p1', 'current');
    expect(res.swapped).toEqual({ removed: 'current', added: 'fresh', via: 'agent' });
    expect(res.shoppingList.sections.flatMap((s) => s.items).map((i) => i.name)).toEqual(['rice']);
    const [request, , options] = agent.run.mock.calls[0];
    expect(request).toMatchObject({ allergies: ['peanuts'], maxResults: 1 });
    expect(options).toMatchObject({ excludeVideoIds: ['current'], budgets: { maxSearches: 1, maxAnalyses: 2 } });
  });

  it('reports a conflict when nothing safe can replace the recipe', async () => {
    const { svc, store } = build([]);
    await savePlan(store);
    await expect(svc.swap('p1', 'current')).rejects.toThrow(ConflictException);
    expect((await svc.get('p1')).version).toBe(1);
  });
});
