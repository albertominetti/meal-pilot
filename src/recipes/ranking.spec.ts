import { RANKING_WEIGHTS, scoreRecipe, selectRanked } from './ranking';
import { analysis, ingredient } from '../../test/fixtures/analysis';

const ctx = { isTrusted: (id?: string) => id === 'UC_trusted' };

describe('scoreRecipe', () => {
  it('applies each weight from RANKING_WEIGHTS', () => {
    const s = scoreRecipe(
      analysis({
        channelId: 'UC_trusted',
        restrictionTags: ['vegan'],
        nutritionSignals: ['high-protein'],
        ingredients: [ingredient('chickpea', 400, 'g'), ingredient('oil', null, null)],
        prepMinutes: 20,
      }),
      { ...ctx, restrictions: ['vegetarian', 'gluten-free'], healthGoals: ['high-protein', 'low-sodium'], maxCookMinutes: 30 },
    );
    expect(s.breakdown).toEqual({
      restrictionMatched: RANKING_WEIGHTS.restrictionMatched, // vegan implies vegetarian
      restrictionMissing: RANKING_WEIGHTS.restrictionMissing, // gluten-free
      goalMatched: RANKING_WEIGHTS.goalMatched,
      goalMissing: RANKING_WEIGHTS.goalMissing,
      fullCoverage: RANKING_WEIGHTS.fullCoverage,
      trustedChannel: RANKING_WEIGHTS.trustedChannel,
      highConfidenceShare: RANKING_WEIGHTS.highConfidenceShare / 2,
      fitsTime: RANKING_WEIGHTS.fitsTime,
    });
    expect(s.score).toBe(2 - 3 + 2 - 1 + 2 + 1.5 + 1 + 1);
  });

  it('penalises a main protein that is already selected', () => {
    const a = analysis({ mainProtein: 'tofu' });
    const base = scoreRecipe(a, ctx).score;
    const penalised = scoreRecipe(a, ctx, [{ mainProtein: 'tofu' }, { mainProtein: 'tofu' }]).score;
    expect(base - penalised).toBe(-2 * RANKING_WEIGHTS.repeatedProtein);
  });

  it('does not penalise recipes without a main protein', () => {
    const a = analysis({ mainProtein: 'none' });
    expect(scoreRecipe(a, ctx, [{ mainProtein: 'none' }]).score).toBe(scoreRecipe(a, ctx).score);
  });
});

describe('selectRanked', () => {
  it('prefers variety over a slightly higher-scoring repeat', () => {
    const picked = selectRanked(
      [
        analysis({ videoId: 'c1', mainProtein: 'chickpea', channelId: 'UC_trusted' }),
        analysis({ videoId: 'c2', mainProtein: 'chickpea', channelId: 'UC_trusted' }),
        analysis({ videoId: 'l1', mainProtein: 'lentil' }),
      ],
      ctx,
      2,
    );
    expect(picked.map((p) => p.analysis.videoId)).toEqual(['c1', 'l1']);
  });

  it('returns at most max items', () => {
    expect(selectRanked([analysis(), analysis({ videoId: 'v2' })], ctx, 1)).toHaveLength(1);
  });

  it('adds the user rating around a neutral 3', () => {
    const ctx = { isTrusted: () => false, feedback: new Map([['v1', { userRating: 5, cookedCount: 2 }], ['v2', { userRating: 2, cookedCount: 0 }]]) };
    expect(scoreRecipe(analysis({ videoId: 'v1' }), ctx).breakdown.userRating).toBe(1.5);
    expect(scoreRecipe(analysis({ videoId: 'v2' }), ctx).breakdown.userRating).toBe(-0.75);
    expect(scoreRecipe(analysis({ videoId: 'v3' }), ctx).breakdown.userRating).toBeUndefined();
  });
});

