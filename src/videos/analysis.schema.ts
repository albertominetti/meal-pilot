import { z } from 'zod';

/**
 * Video analysis contract (schema v2).
 *
 * Bump ANALYSIS_SCHEMA_VERSION whenever the prompt or schema changes in a way
 * that should invalidate cached analyses.
 */
export const ANALYSIS_SCHEMA_VERSION = 2;

/** EU Regulation 1169/2011 Annex II — the 14 declarable allergens. */
export const CANONICAL_ALLERGENS = [
  'gluten',
  'crustaceans',
  'eggs',
  'fish',
  'peanuts',
  'soybeans',
  'milk',
  'tree_nuts',
  'celery',
  'mustard',
  'sesame',
  'sulphites',
  'lupin',
  'molluscs',
] as const;
export type CanonicalAllergen = (typeof CANONICAL_ALLERGENS)[number];

export const RESTRICTION_TAGS = [
  'vegan',
  'vegetarian',
  'pescatarian',
  'gluten-free',
  'dairy-free',
  'nut-free',
  'egg-free',
  'halal',
  'kosher',
] as const;

export const NUTRITION_SIGNALS = [
  'low-sodium',
  'moderate-sodium',
  'high-sodium',
  'low-carb',
  'high-protein',
  'high-fiber',
  'low-sugar',
  'low-fat',
  'whole-foods',
  'quick-prep',
  'deep-fried',
  'processed-ingredients',
] as const;

export const CONFIDENCE = ['confirmed', 'likely', 'possible'] as const;

const AllergenFinding = z.object({
  allergen: z.enum(CANONICAL_ALLERGENS),
  evidence: z.string(),
  timestamp: z.string().nullish(),
  confidence: z.enum(CONFIDENCE),
});

const Ingredient = z.object({
  name: z.string().min(1),
  quantity: z.string().nullish(),
  timestamp: z.string().nullish(),
});

/** What the model must return (validated with zod after JSON.parse). */
export const ModelAnalysisSchema = z.object({
  recipeName: z.string(),
  servings: z.number().nullish(),
  ingredients: z.array(Ingredient),
  steps: z.array(z.string()),
  allergens: z.array(AllergenFinding),
  crossContactNotes: z.array(z.string()),
  sodiumSources: z.array(z.string()),
  nutritionSignals: z.array(z.enum(NUTRITION_SIGNALS)),
  restrictionTags: z.array(z.enum(RESTRICTION_TAGS)),
  summary: z.string(),
  coverage: z.enum(['full', 'partial']),
});
export type ModelAnalysis = z.infer<typeof ModelAnalysisSchema>;
export type AllergenFindingT = z.infer<typeof AllergenFinding>;
export type IngredientT = z.infer<typeof Ingredient>;

/**
 * Hand-written JSON Schema sent as `response_format.schema`. Kept to the
 * conservative subset Gemini supports (no $ref/oneOf).
 */
export const MODEL_ANALYSIS_JSON_SCHEMA: Record<string, any> = {
  type: 'object',
  properties: {
    recipeName: { type: 'string' },
    servings: { type: 'number' },
    ingredients: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          quantity: { type: 'string' },
          timestamp: { type: 'string', description: 'mm:ss where it appears' },
        },
        required: ['name'],
      },
    },
    steps: { type: 'array', items: { type: 'string' } },
    allergens: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          allergen: { type: 'string', enum: [...CANONICAL_ALLERGENS] },
          evidence: { type: 'string', description: 'What was said or shown that indicates it' },
          timestamp: { type: 'string' },
          confidence: { type: 'string', enum: [...CONFIDENCE] },
        },
        required: ['allergen', 'evidence', 'confidence'],
      },
    },
    crossContactNotes: { type: 'array', items: { type: 'string' } },
    sodiumSources: { type: 'array', items: { type: 'string' } },
    nutritionSignals: { type: 'array', items: { type: 'string', enum: [...NUTRITION_SIGNALS] } },
    restrictionTags: { type: 'array', items: { type: 'string', enum: [...RESTRICTION_TAGS] } },
    summary: { type: 'string' },
    coverage: { type: 'string', enum: ['full', 'partial'] },
  },
  required: [
    'recipeName',
    'ingredients',
    'steps',
    'allergens',
    'crossContactNotes',
    'sodiumSources',
    'nutritionSignals',
    'restrictionTags',
    'summary',
    'coverage',
  ],
};

export type AnalysisProvider = 'gemini' | 'mock';
export type AnalysisStatus = 'ok' | 'unavailable';

/** Stored + returned per video. */
export interface VideoAnalysis {
  videoId: string;
  title: string;
  channel: string;
  durationSec?: number;
  status: AnalysisStatus;
  /** Machine-readable reason when status = unavailable. */
  error?: string;
  provider: AnalysisProvider;
  model: string;
  schemaVersion: number;
  analyzedAt: string;
  recipeName: string;
  servings?: number | null;
  ingredients: IngredientT[];
  steps: string[];
  allergens: AllergenFindingT[];
  crossContactNotes: string[];
  sodiumSources: string[];
  nutritionSignals: string[];
  restrictionTags: string[];
  summary: string;
  coverage: 'full' | 'partial';
}

export interface VideoRef {
  videoId: string;
  title: string;
  channel: string;
  durationSec?: number;
}

export function unavailableAnalysis(
  ref: VideoRef,
  provider: AnalysisProvider,
  model: string,
  error: string,
): VideoAnalysis {
  return {
    ...ref,
    status: 'unavailable',
    error,
    provider,
    model,
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    analyzedAt: new Date().toISOString(),
    recipeName: ref.title,
    ingredients: [],
    steps: [],
    allergens: [],
    crossContactNotes: [],
    sodiumSources: [],
    nutritionSignals: [],
    restrictionTags: [],
    summary: `Analysis unavailable (${error}).`,
    coverage: 'partial',
  };
}
