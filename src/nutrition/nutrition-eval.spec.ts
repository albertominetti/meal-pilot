import * as fs from 'fs';
import * as path from 'path';
import { ingredient } from '../../test/fixtures/analysis';
import { Ingredient } from '../videos/analyzers/analysis.schema';
import { FdcFood, parseFood, RawFood } from './fdc-food';
import { pickFood } from './food-match';
import { computeNutrition, mappingKey, matchHints } from './nutrition';
import { normalizeIngredientName } from '../recipes/normalize';

function hits(name: string): FdcFood[] {
  const file = path.join(__dirname, '../../test/fixtures/fdc', `search_${name.replace(/ /g, '_')}.json`);
  return (JSON.parse(fs.readFileSync(file, 'utf8')).foods as RawFood[]).map(parseFood);
}

/** The full chain on recorded FDC data: pick the food from search hits, then compute. */
function compute(servings: number, ingredients: Ingredient[]) {
  const foods = new Map<string, FdcFood | null>();
  for (const i of ingredients) {
    const name = normalizeIngredientName(i.name);
    foods.set(mappingKey(i), pickFood(name, matchHints(i), hits(name)));
  }
  return computeNutrition({ servings, ingredients }, foods);
}

const canned = (name: string, grams: number) => ingredient(name, grams, 'g', { rawText: `${grams} g canned ${name}` });

/**
 * Five recipes checked by hand against USDA SR Legacy values per 100 g
 * (chickpeas canned 139 kcal / 7.05 g protein, dry 378 / 20.5; lentils 352 /
 * 24.6; onion 40 / 1.1; garlic 149 / 6.36; carrot 41 / 0.93; tomatoes canned
 * 16 / 0.79, roma 22 / 0.70; olive oil 884 / 0, 1 tbsp = 13.8 g).
 * Expected values are per serving; the tolerance is ±15%.
 */
const RECIPES: Array<[string, number, Ingredient[], { kcal: number; protein: number }]> = [
  [
    'chickpea tomato stew',
    2,
    [canned('chickpea', 240), canned('tomato', 400), ingredient('onion', 150, 'g'), ingredient('olive oil', 1, 'tbsp')],
    // (333.6 + 64 + 60 + 122.0) / 2; (16.92 + 3.16 + 1.65) / 2
    { kcal: 289.8, protein: 10.87 },
  ],
  [
    'lentil soup',
    4,
    [
      ingredient('lentil', 200, 'g'),
      ingredient('carrot', 150, 'g'),
      ingredient('onion', 100, 'g'),
      ingredient('garlic', 10, 'g'),
      ingredient('olive oil', 1, 'tbsp'),
    ],
    // (704 + 61.5 + 40 + 14.9 + 122.0) / 4; (49.2 + 1.40 + 1.1 + 0.64) / 4
    { kcal: 235.6, protein: 13.08 },
  ],
  [
    'lentil and tomato salad',
    2,
    [ingredient('lentil', 100, 'g'), ingredient('tomato', 200, 'g'), ingredient('onion', 50, 'g'), ingredient('olive oil', 2, 'tbsp')],
    // (352 + 44 + 20 + 244.0) / 2; (24.6 + 1.39 + 0.55) / 2
    { kcal: 330.0, protein: 13.27 },
  ],
  [
    'roast carrots',
    4,
    [ingredient('carrot', 500, 'g'), ingredient('olive oil', 2, 'tbsp'), ingredient('garlic', 15, 'g')],
    // (205 + 244.0 + 22.4) / 4; (4.65 + 0.95) / 4
    { kcal: 117.8, protein: 1.4 },
  ],
  [
    'garlic chickpeas from dry',
    3,
    [ingredient('chickpea', 250, 'g'), ingredient('garlic', 20, 'g'), ingredient('olive oil', 1, 'tbsp'), ingredient('onion', 100, 'g')],
    // (945 + 29.8 + 122.0 + 40) / 3; (51.25 + 1.27 + 1.1) / 3
    { kcal: 378.9, protein: 17.87 },
  ],
];

describe('nutrient eval: five hand-checked recipes within ±15%', () => {
  it.each(RECIPES)('%s', (_name, servings, ingredients, expected) => {
    const n = compute(servings, ingredients);
    expect(n.completeness).toBe(1);
    expect(Math.abs(n.perServing!.kcal - expected.kcal) / expected.kcal).toBeLessThanOrEqual(0.15);
    expect(Math.abs(n.perServing!.protein - expected.protein) / expected.protein).toBeLessThanOrEqual(0.15);
  });

  it('would miss badly with FDC top hits (why the matcher exists)', () => {
    // Top hit for "chickpea" is chickpea flour: 387 kcal per 100 g instead of 139 for canned.
    const top = hits('chickpea')[0];
    expect(top.description).toMatch(/flour/i);
    expect(top.nutrients.kcal! / 139).toBeGreaterThan(2.5);
  });
});
