import { analysis, ingredient } from '../../test/fixtures/analysis';
import { AMOUNT_UNCLEAR, buildShoppingList } from './shopping-list';
import { sectionFor } from './sections';

function find(list: ReturnType<typeof buildShoppingList>, name: string) {
  return [...list.sections.flatMap((s) => s.items), ...list.pantry].find((i) => i.name === name);
}

describe('buildShoppingList', () => {
  const curry = analysis({
    videoId: 'curry',
    servings: 2,
    ingredients: [
      ingredient('chickpeas', 400, 'g'),
      ingredient('garlic', 2, 'clove'),
      ingredient('olive oil', 1, 'tbsp'),
      ingredient('coconut milk', 1, 'can', { packaged: true }),
      ingredient('salt', 1, 'pinch'),
    ],
  });
  const salad = analysis({
    videoId: 'salad',
    servings: 4,
    ingredients: [
      ingredient('garbanzo beans', 240, 'g'),
      ingredient('Garlic', 1, 'clove'),
      ingredient('fresh coriander', null, null),
      ingredient('cucumber', 1, 'piece'),
    ],
  });

  it('scales to the household, merges aliases and keeps links to recipes', () => {
    const list = buildShoppingList([{ analysis: curry }, { analysis: salad }], 4);
    // curry x2 = 800 g, salad x1 = 240 g -> 1040 g -> rounded 1.1 kg
    expect(find(list, 'chickpea')).toEqual({
      key: 'chickpea|g',
      name: 'chickpea',
      amount: 1.1,
      unit: 'kg',
      exactAmount: 1.04,
      uncertain: false,
      fromRecipes: ['curry', 'salad'],
    });
    expect(find(list, 'garlic')).toMatchObject({ amount: 5, unit: 'clove' });
    expect(find(list, 'coconut milk')).toMatchObject({ amount: 2, unit: 'can' });
    expect(list.householdSize).toBe(4);
  });

  it('never invents amounts for unclear quantities', () => {
    const list = buildShoppingList([{ analysis: salad }], 2);
    expect(find(list, 'coriander')).toMatchObject({ amount: null, uncertain: true, note: AMOUNT_UNCLEAR });
    // pinch is unclear too, and salt is a pantry staple
    const withCurry = buildShoppingList([{ analysis: curry }], 2);
    expect(withCurry.pantry.find((i) => i.name === 'salt')).toMatchObject({ amount: null, uncertain: true });
  });

  it('puts staples in the pantry group and groups the rest by section', () => {
    const list = buildShoppingList([{ analysis: curry }, { analysis: salad }], 2);
    expect(list.pantry.map((i) => i.name)).toEqual(['olive oil', 'salt']);
    const sections = list.sections.map((s) => s.section);
    expect(sections).toEqual(['produce', 'canned & jars']);
    expect(list.sections[0].items.map((i) => i.name)).toEqual(['coriander', 'cucumber', 'garlic']);
  });

  it('uses factor 1 and warns when servings are unknown', () => {
    const list = buildShoppingList([{ analysis: { ...curry, servings: undefined } }], 6);
    expect(find(list, 'chickpea')).toMatchObject({ amount: 400, unit: 'g' });
    expect(list.warnings[0]).toMatch(/Servings unknown/);
  });

  it('honours per-recipe servings over the household size', () => {
    const list = buildShoppingList([{ analysis: curry, servings: 1 }], 4);
    expect(find(list, 'chickpea')).toMatchObject({ exactAmount: 200 });
  });

  it('converts volume to mass only with a known density, otherwise warns', () => {
    const a = analysis({ videoId: 'a', servings: 1, ingredients: [ingredient('rice', 200, 'g')] });
    const b = analysis({ videoId: 'b', servings: 1, ingredients: [ingredient('rice', 1, 'cup')] });
    expect(find(buildShoppingList([{ analysis: a }, { analysis: b }], 1), 'rice')).toMatchObject({
      unit: 'g',
      exactAmount: 404, // 200 g + 240 ml * 0.85
    });

    const c = analysis({ videoId: 'c', servings: 1, ingredients: [ingredient('garlic', 10, 'g')] });
    const d = analysis({ videoId: 'd', servings: 1, ingredients: [ingredient('garlic', 2, 'clove')] });
    const list = buildShoppingList([{ analysis: c }, { analysis: d }], 1);
    expect(list.warnings).toContain('Could not merge garlic (g + clove); listed separately.');
    expect(list.sections[0].items.filter((i) => i.name === 'garlic')).toHaveLength(2);
  });

  it('marks a merged line uncertain when part of it is unclear', () => {
    const a = analysis({ videoId: 'a', servings: 1, ingredients: [ingredient('spinach', 100, 'g')] });
    const b = analysis({ videoId: 'b', servings: 1, ingredients: [ingredient('spinach', null, null)] });
    expect(find(buildShoppingList([{ analysis: a }, { analysis: b }], 1), 'spinach')).toMatchObject({
      amount: 100,
      uncertain: true,
      fromRecipes: ['a', 'b'],
    });
  });
});

describe('sectionFor', () => {
  it.each([
    ['tofu', 'dairy & eggs'],
    ['chicken breast', 'meat & fish'],
    ['red curry paste', 'canned & jars'],
    ['soy sauce', 'spices & condiments'],
    ['brown lentil', 'dry goods & grains'],
    ['frozen pea', 'frozen'],
    ['carrot', 'produce'],
    ['sourdough bread', 'bakery'],
    ['xanthan gum', 'other'],
  ])('%s -> %s', (name, section) => {
    expect(sectionFor(name)).toBe(section);
  });
});
