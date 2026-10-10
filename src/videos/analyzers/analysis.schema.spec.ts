import {
  AnalysisOutputSchema,
  ANALYSIS_JSON_SCHEMA,
  ANALYSIS_SCHEMA_VERSION,
} from './analysis.schema';

describe('Analysis schema v2', () => {
  it('validates correct analysis payload', () => {
    const valid = {
      recipeName: 'Lentil Stew',
      servings: 4,
      ingredients: [{ name: 'brown lentils' }, { name: 'carrots' }],
      steps: ['Sauté carrots', 'Simmer lentils with water'],
      allergens: [
        {
          allergen: 'celery',
          evidence: 'chopped celery added at 01:15',
          confidence: 'confirmed',
        },
      ],
      crossContactNotes: [],
      sodiumSources: ['sea salt'],
      nutritionSignals: ['low-sodium', 'high-fiber'],
      restrictionTags: ['vegan', 'gluten-free'],
      summary: 'A nutritious low-sodium vegetable and lentil stew.',
      coverage: 'full',
    };

    const parsed = AnalysisOutputSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
    expect(ANALYSIS_SCHEMA_VERSION).toBe(2);
  });

  it('rejects invalid allergen enum', () => {
    const invalid = {
      recipeName: 'Salad',
      ingredients: [{ name: 'lettuce' }],
      steps: ['Toss'],
      allergens: [
        {
          allergen: 'not-a-real-allergen',
          evidence: 'none',
          confidence: 'likely',
        },
      ],
      summary: 'Salad',
    };

    const parsed = AnalysisOutputSchema.safeParse(invalid);
    expect(parsed.success).toBe(false);
  });

  it('provides JSON schema with required fields', () => {
    expect(ANALYSIS_JSON_SCHEMA.required).toContain('recipeName');
    expect(ANALYSIS_JSON_SCHEMA.required).toContain('allergens');
  });
});
