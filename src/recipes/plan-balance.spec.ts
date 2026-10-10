import { checkPlanBalance } from './plan-balance';
import { analysis, ingredient } from '../../test/fixtures/analysis';

describe('checkPlanBalance', () => {
  const plan = [
    analysis({ videoId: 'a', mainProtein: 'chickpea', prepMinutes: 20, ingredients: [ingredient('garlic', 2, 'clove'), ingredient('chickpea', 400, 'g')] }),
    analysis({ videoId: 'b', mainProtein: 'chickpea', recipeName: 'Hummus Bowl', prepMinutes: 45, ingredients: [ingredient('garlic', 1, 'clove')] }),
    analysis({ videoId: 'c', mainProtein: 'chickpea', recipeName: 'Chana Masala', prepMinutes: undefined, coverage: 'partial', restrictionTags: ['vegan'] }),
    analysis({ videoId: 'd', mainProtein: 'lentil', recipeName: 'Chickpea Curry' }),
  ];

  it('reports distribution, repeats, time and shared ingredients', () => {
    const b = checkPlanBalance(plan, { maxCookMinutes: 30, restrictions: ['vegan'], healthGoals: ['high-fiber'] });
    expect(b.proteins).toEqual({ chickpea: 3, lentil: 1 });
    expect(b.repeatedRecipes).toEqual(['d']);
    expect(b.totalPrepMinutes).toBe(20 + 45 + 30);
    expect(b.maxPrepMinutes).toBe(45);
    expect(b.unknownPrepTime).toEqual(['c']);
    expect(b.overTimeLimit).toEqual(['b']);
    expect(b.partialCoverage).toEqual(['c']);
    expect(b.sharedIngredients.names).toContain('garlic');
    expect(b.restrictionGaps).toEqual([{ restriction: 'vegan', videoIds: ['a', 'b', 'd'] }]);
    expect(b.uncoveredGoals).toEqual(['high-fiber']);
    expect(b.warnings.join(' ')).toMatch(/3 recipes use chickpea/);
  });

  it('has no warnings for a balanced plan', () => {
    const b = checkPlanBalance(
      [analysis({ videoId: 'a' }), analysis({ videoId: 'b', mainProtein: 'tofu', recipeName: 'Tofu Stir Fry' })],
      {},
    );
    expect(b.warnings).toEqual([]);
  });
});
