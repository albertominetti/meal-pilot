import { analysis, ingredient } from '../../test/fixtures/analysis';
import { matchGoals } from '../meal-plan/profile-fit';
import { NutrientTotals, NutritionResult } from './nutrition';
import { nutritionFacts } from './nutrition-facts';

function nutrition(perServing: Partial<NutrientTotals>, overrides: Partial<NutritionResult> = {}): NutritionResult {
  const totals: NutrientTotals = { kcal: 500, protein: 10, fat: 10, saturatedFat: 2, carbs: 60, sugar: 5, fiber: 4, sodium: 800, ...perServing };
  const full = { kcal: 1, protein: 1, fat: 1, saturatedFat: 1, carbs: 1, sugar: 1, fiber: 1, sodium: 1 };
  return {
    perServing: totals,
    total: totals,
    servings: 1,
    completeness: 0.9,
    nutrientCompleteness: full,
    partial: false,
    unresolved: [],
    estimated: true,
    source: 'USDA FoodData Central',
    version: 1,
    ...overrides,
  };
}

describe('nutritionFacts', () => {
  it.each([
    [{ protein: 20 }, 'high-protein'],
    [{ sodium: 600 }, 'low-sodium'],
    [{ sodium: 1000 }, 'moderate-sodium'],
    [{ fiber: 8 }, 'high-fiber'],
    [{ carbs: 30 }, 'low-carb'],
    [{ sugar: 10 }, 'low-sugar'],
  ])('%o per serving -> %s', (perServing, signal) => {
    expect(nutritionFacts(analysis({ nutrition: nutrition(perServing) })).signals).toContain(signal);
  });

  it('replaces the model nutrient labels in restriction tags with computed ones', () => {
    const facts = nutritionFacts(
      analysis({ restrictionTags: ['vegan', 'low-sodium'], nutritionSignals: ['high-protein'], nutrition: nutrition({}) }),
    );
    expect(facts.basis).toBe('nutrients');
    // 800 mg sodium is moderate, not low: the model's low-sodium tag is replaced.
    expect(facts.tags).toEqual(['vegan', 'moderate-sodium', 'low-sugar']);
    expect(facts.signals).toContain('moderate-sodium');
    expect(facts.signals).not.toContain('high-protein');
  });

  it('adds prep-time and whole-food labels from the recipe itself', () => {
    const facts = nutritionFacts(
      analysis({ prepMinutes: 25, ingredients: [ingredient('lentil', 200, 'g')], nutrition: nutrition({}) }),
    );
    expect(facts.signals).toEqual(expect.arrayContaining(['quick-prep', 'whole-foods']));
  });

  it('falls back to model labels when nutrients are partial or missing', () => {
    const partial = nutritionFacts(
      analysis({ nutritionSignals: ['high-protein'], nutrition: nutrition({ protein: 40 }, { completeness: 0.5, partial: true }) }),
    );
    expect(partial).toMatchObject({ basis: 'model', signals: ['high-protein'], perServing: null });
    expect(nutritionFacts(analysis({ nutritionSignals: [] })).basis).toBe('none');
  });

  it('never labels a nutrient that most of the recipe did not report', () => {
    const facts = nutritionFacts(
      analysis({ nutrition: nutrition({ sugar: 1 }, { nutrientCompleteness: { ...nutrition({}).nutrientCompleteness, sugar: 0.4 } }) }),
    );
    expect(facts.signals).not.toContain('low-sugar');
    expect(facts.covers('low-sugar')).toBe(false);
  });
});

describe('matchGoals with computed nutrients', () => {
  it('matches, misses, or cannot verify each goal', () => {
    const a = analysis({
      nutrition: nutrition({ protein: 30, sodium: 900 }, { nutrientCompleteness: { ...nutrition({}).nutrientCompleteness, sugar: 0.2 } }),
    });
    expect(matchGoals(a, ['high-protein', 'low-sodium', 'low-sugar', 'weight-loss'])).toEqual({
      matched: ['high-protein'],
      missing: ['low-sodium'],
      unverifiable: ['low-sugar', 'weight-loss'],
    });
  });

  it('cannot verify nutrient goals without any nutrient basis', () => {
    expect(matchGoals(analysis({ nutritionSignals: [] }), ['high-protein']).unverifiable).toEqual(['high-protein']);
  });
});
