import { ingredient } from '../../test/fixtures/analysis';
import { FdcFood } from './fdc-food';
import { computeNutrition, mappingKey } from './nutrition';

const food = (fdcId: number, nutrients: FdcFood['nutrients']): FdcFood => ({
  fdcId,
  description: `food ${fdcId}`,
  dataType: 'SR Legacy',
  nutrients,
  portions: [],
});

const lentil = food(1, { kcal: 352, protein: 24.6, fat: 1.1, saturatedFat: 0.2, carbs: 63.4, sugar: 2, fiber: 10.7, sodium: 6 });
const oil = food(2, { kcal: 884, protein: 0, fat: 100, saturatedFat: 13.8, carbs: 0, sugar: 0, fiber: 0, sodium: 2 });

describe('computeNutrition', () => {
  it('sums per-100 g values by grams and divides by servings', () => {
    const n = computeNutrition(
      { servings: 2, ingredients: [ingredient('lentil', 200, 'g'), ingredient('olive oil', 1, 'tbsp')] },
      new Map([
        ['lentil', lentil],
        ['olive oil', oil],
      ]),
    );
    // 200 g lentils = 704 kcal, 49.2 g protein; 1 tbsp oil = 13.8 g = 122 kcal.
    expect(n.total.kcal).toBe(826);
    expect(n.perServing).toMatchObject({ kcal: 413, protein: 24.6 });
    expect(n.completeness).toBe(1);
    expect(n.partial).toBe(false);
    expect(n).toMatchObject({ estimated: true, source: 'USDA FoodData Central', servings: 2 });
  });

  it('counts unmatched and unclear ingredients against completeness', () => {
    const n = computeNutrition(
      {
        servings: 2,
        ingredients: [ingredient('lentil', 200, 'g'), ingredient('mystery paste', 200, 'g'), ingredient('salt', null, null)],
      },
      new Map([['lentil', lentil]]),
    );
    // 200 resolved of 200 + 200 + a nominal 20 g for "salt, no amount".
    expect(n.completeness).toBe(0.48);
    expect(n.partial).toBe(true);
    expect(n.unresolved).toEqual(['mystery paste', 'salt']);
  });

  it('tracks completeness per nutrient when a food lacks one', () => {
    const noSugar = food(3, { kcal: 40, protein: 1, fat: 0, saturatedFat: 0, carbs: 9, fiber: 2, sodium: 4 });
    const n = computeNutrition(
      { servings: 1, ingredients: [ingredient('lentil', 100, 'g'), ingredient('onion', 300, 'g')] },
      new Map([
        ['lentil', lentil],
        ['onion', noSugar],
      ]),
    );
    expect(n.nutrientCompleteness.sugar).toBe(0.25);
    expect(n.nutrientCompleteness.protein).toBe(1);
  });

  it('gives no per-serving figure when servings are unknown', () => {
    const n = computeNutrition({ ingredients: [ingredient('lentil', 100, 'g')] }, new Map([['lentil', lentil]]));
    expect(n.perServing).toBeNull();
    expect(n.total.kcal).toBe(352);
  });

  it('keys canned products separately from dry ones', () => {
    expect(mappingKey(ingredient('chickpeas', 1, 'can'))).toBe('chickpea|canned');
    expect(mappingKey(ingredient('chickpea', 200, 'g', { rawText: '200 g canned chickpeas' }))).toBe('chickpea|canned');
    expect(mappingKey(ingredient('chickpea', 200, 'g'))).toBe('chickpea');
  });
});
