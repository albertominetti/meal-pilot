import { Ingredient, VideoAnalysis } from '../../src/videos/analyzers/analysis.schema';

export function ingredient(name: string, quantity: number | null, unit: Ingredient['unit'], extra: Partial<Ingredient> = {}): Ingredient {
  return {
    name,
    quantity,
    unit,
    rawText: quantity === null ? `some ${name}` : `${quantity} ${unit ?? ''} ${name}`.replace(/\s+/g, ' '),
    confidence: quantity === null ? 'low' : 'high',
    source: 'video',
    packaged: false,
    ...extra,
  };
}

export function analysis(overrides: Partial<VideoAnalysis> = {}): VideoAnalysis {
  return {
    videoId: 'v1',
    title: 'Chickpea Curry',
    channel: 'Chef',
    channelId: 'UC_chef',
    recipeName: 'Chickpea Curry',
    servings: 2,
    prepMinutes: 30,
    mainProtein: 'chickpea',
    cuisine: 'indian',
    mealType: ['dinner'],
    ingredients: [ingredient('chickpea', 400, 'g'), ingredient('olive oil', null, null)],
    steps: ['Cook'],
    allergens: [],
    crossContactNotes: [],
    sodiumSources: [],
    nutritionSignals: [],
    restrictionTags: [],
    summary: 'A curry',
    coverage: 'full',
    labelCheck: [],
    nutritionSignalsSource: 'model',
    status: 'ok',
    provider: 'mock',
    model: 'mock',
    analyzedAt: new Date().toISOString(),
    schemaVersion: 3,
    transcript: '',
    detectedAllergens: [],
    ...overrides,
  };
}
