import { ANALYSIS_SCHEMA_VERSION, IngredientSchema } from './analysis.schema';
import { MockVideoAnalyzer, parseDescriptionIngredients } from './mock-video-analyzer';

describe('MockVideoAnalyzer (schema v3)', () => {
  const analyzer = new MockVideoAnalyzer();

  it('produces valid v3 ingredients, prep time and label checks', async () => {
    const out = await analyzer.analyze({
      videoId: 'v1',
      title: 'Low-Sodium Vegetarian Lentil Soup',
      channel: 'Healthy Kitchen',
    });
    expect(out.schemaVersion).toBe(ANALYSIS_SCHEMA_VERSION);
    expect(typeof out.prepMinutes).toBe('number');
    expect(out.mealType.length).toBeGreaterThan(0);
    for (const i of out.ingredients) {
      expect(() => IngredientSchema.parse(i)).not.toThrow();
    }
    expect(Array.isArray(out.labelCheck)).toBe(true);
    expect(out.nutritionSignalsSource).toBe('model');
  });

  it('reads quantities from the description and marks their source', async () => {
    const out = await analyzer.analyze({
      videoId: 'v2',
      title: 'Easy Vegetarian Tofu Curry',
      channel: 'Spice Route',
      description:
        'Serves 3. Ingredients: 400g firm tofu, 2 tbsp red curry paste, 400ml coconut milk.',
    });
    expect(out.servings).toBe(3);
    expect(out.mainProtein).toBe('tofu');
    const tofu = out.ingredients.find((i) => i.name === 'firm tofu');
    expect(tofu).toMatchObject({ quantity: 400, unit: 'g', source: 'description' });
    expect(out.labelCheck).toEqual(['red curry paste', 'coconut milk']);
  });
});

describe('parseDescriptionIngredients', () => {
  it.each([
    ['200g brown lentils', { name: 'brown lentil', quantity: 200, unit: 'g' }],
    ['2 cloves garlic', { name: 'garlic', quantity: 2, unit: 'clove' }],
    ['1 can (400g) chickpeas', { name: 'chickpea', quantity: 1, unit: 'can' }],
    ['1 l low-sodium vegetable stock', { name: 'low-sodium vegetable stock', quantity: 1, unit: 'l', packaged: true }],
    ['2 carrots', { name: 'carrot', quantity: 2, unit: 'piece' }],
    ['1 tbsp olive oil', { name: 'olive oil', quantity: 1, unit: 'tbsp' }],
  ])('parses "%s"', (line, expected) => {
    const [parsed] = parseDescriptionIngredients(`Ingredients: ${line}`);
    expect(parsed).toMatchObject(expected);
    expect(parsed.rawText).toBe(line);
  });

  it('ignores prose without quantities', () => {
    expect(parseDescriptionIngredients('Full recipe on our blog.')).toEqual([]);
  });
});
