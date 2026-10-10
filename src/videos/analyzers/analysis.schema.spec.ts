import {
  ANALYSIS_SCHEMA_VERSION,
  AnalysisOutputSchema,
  IngredientSchema,
  INGREDIENT_UNITS,
  MAIN_PROTEINS,
  MEAL_TYPES,
} from './analysis.schema';

describe('Analysis Schema v3', () => {
  it('has schema version 3', () => {
    expect(ANALYSIS_SCHEMA_VERSION).toBe(3);
  });

  it('validates a complete v3 ingredient with unit and quantity', () => {
    const raw = {
      name: 'chickpea',
      quantity: 400,
      unit: 'g',
      rawText: '1 can (400g) chickpeas, drained',
      confidence: 'high',
      source: 'both',
      packaged: false,
    };
    const parsed = IngredientSchema.parse(raw);
    expect(parsed.name).toBe('chickpea');
    expect(parsed.quantity).toBe(400);
    expect(parsed.unit).toBe('g');
    expect(parsed.packaged).toBe(false);
  });

  it('allows null quantity and null unit for unspecified amounts', () => {
    const raw = {
      name: 'olive oil',
      quantity: null,
      unit: null,
      rawText: 'a generous drizzle of olive oil',
      confidence: 'low',
      source: 'video',
      packaged: false,
    };
    const parsed = IngredientSchema.parse(raw);
    expect(parsed.quantity).toBeNull();
    expect(parsed.unit).toBeNull();
  });

  it('validates a complete v3 analysis output with prepMinutes and metadata', () => {
    const raw = {
      recipeName: 'Chickpea Coconut Curry',
      servings: 4,
      prepMinutes: 25,
      mainProtein: 'chickpea',
      cuisine: 'indian',
      mealType: ['lunch', 'dinner'],
      ingredients: [
        {
          name: 'chickpea',
          quantity: 400,
          unit: 'g',
          rawText: '400g chickpeas',
          confidence: 'high',
          source: 'description',
          packaged: false,
        },
        {
          name: 'curry paste',
          quantity: 2,
          unit: 'tbsp',
          rawText: '2 tbsp red curry paste',
          confidence: 'high',
          source: 'both',
          packaged: true,
        },
      ],
      steps: ['Sauté paste', 'Add chickpeas and simmer'],
      allergens: [],
      crossContactNotes: [],
      sodiumSources: [],
      nutritionSignals: ['whole-foods'],
      restrictionTags: ['vegan', 'gluten-free'],
      summary: 'A fast chickpea curry',
      coverage: 'full',
    };
    const parsed = AnalysisOutputSchema.parse(raw);
    expect(parsed.recipeName).toBe('Chickpea Coconut Curry');
    expect(parsed.prepMinutes).toBe(25);
    expect(parsed.mainProtein).toBe('chickpea');
    expect(parsed.cuisine).toBe('indian');
    expect(parsed.mealType).toEqual(['lunch', 'dinner']);
    expect(parsed.ingredients[1].packaged).toBe(true);
  });

  it('rejects unknown unit strings not in the unit enum', () => {
    const raw = {
      name: 'parsley',
      quantity: 1,
      unit: 'handful',
      rawText: '1 handful parsley',
      confidence: 'low',
      source: 'video',
      packaged: false,
    };
    expect(() => IngredientSchema.parse(raw)).toThrow();
  });

  it('exports expected constants', () => {
    expect(INGREDIENT_UNITS).toContain('g');
    expect(MAIN_PROTEINS).toContain('chickpea');
    expect(MEAL_TYPES).toContain('dinner');
  });
});
