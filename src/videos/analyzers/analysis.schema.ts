import { z } from 'zod';
import { CANONICAL_ALLERGENS } from '../allergy.util';

export const ANALYSIS_SCHEMA_VERSION = 2;

export const KNOWN_NUTRITION_SIGNALS = [
  'low-sodium',
  'moderate-sodium',
  'low-carb',
  'high-protein',
  'high-fiber',
  'quick-prep',
  'whole-foods',
] as const;
export type NutritionSignal = (typeof KNOWN_NUTRITION_SIGNALS)[number];

export const KNOWN_RESTRICTION_TAGS = [
  'vegan',
  'vegetarian',
  'gluten-free',
  'dairy-free',
  'nut-free',
  'low-sodium',
  'low-carb',
  'high-protein',
  'halal',
  'kosher',
] as const;
export type RestrictionTag = (typeof KNOWN_RESTRICTION_TAGS)[number];

export const AllergenConfidenceSchema = z.enum([
  'confirmed',
  'likely',
  'possible',
]);
export type AllergenConfidence = z.infer<typeof AllergenConfidenceSchema>;

export const AllergenEvidenceSchema = z.object({
  allergen: z.enum(CANONICAL_ALLERGENS),
  evidence: z
    .string()
    .describe("Spoken or visual evidence, e.g. 'spoken at 02:14: a spoonful of peanut butter'"),
  timestamp: z.string().optional(),
  confidence: AllergenConfidenceSchema,
});
export type AllergenEvidence = z.infer<typeof AllergenEvidenceSchema>;

export const IngredientSchema = z.object({
  name: z.string(),
  quantity: z.string().optional(),
  timestamp: z.string().optional(),
});
export type Ingredient = z.infer<typeof IngredientSchema>;

export const AnalysisOutputSchema = z.object({
  recipeName: z.string(),
  servings: z.number().optional(),
  durationSec: z.number().optional(),
  ingredients: z.array(IngredientSchema),
  steps: z.array(z.string()),
  allergens: z.array(AllergenEvidenceSchema),
  crossContactNotes: z.array(z.string()).default([]),
  sodiumSources: z.array(z.string()).default([]),
  nutritionSignals: z.array(z.enum(KNOWN_NUTRITION_SIGNALS)).default([]),
  restrictionTags: z.array(z.enum(KNOWN_RESTRICTION_TAGS)).default([]),
  summary: z.string(),
  coverage: z.enum(['full', 'partial']).default('full'),
});
export type AnalysisOutput = z.infer<typeof AnalysisOutputSchema>;

export interface VideoAnalysis extends AnalysisOutput {
  videoId: string;
  title: string;
  channel: string;
  status: 'ok' | 'unavailable';
  error?: string;
  provider: 'gemini' | 'mock';
  model: string;
  analyzedAt: string;
  schemaVersion: number;
  // Computed helpers for backwards-compatibility:
  transcript: string;
  detectedAllergens: string[];
}

/**
 * Standard JSON Schema compatible with Gemini API response_format.
 */
export const ANALYSIS_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    recipeName: {
      type: 'string',
      description: 'The primary dish or recipe prepared in the video.',
    },
    servings: {
      type: 'number',
      description: 'Approximate number of servings if specified or discernible.',
    },
    durationSec: {
      type: 'number',
      description: 'Video length in seconds if discernible.',
    },
    ingredients: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          quantity: { type: 'string' },
          timestamp: { type: 'string' },
        },
        required: ['name'],
      },
      description: 'Explicit ingredients used in the preparation.',
    },
    steps: {
      type: 'array',
      items: { type: 'string' },
      description: 'Step-by-step cooking steps observed.',
    },
    allergens: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          allergen: {
            type: 'string',
            enum: [...CANONICAL_ALLERGENS],
          },
          evidence: {
            type: 'string',
            description: 'Explicit evidence with quote or observation.',
          },
          timestamp: { type: 'string' },
          confidence: {
            type: 'string',
            enum: ['confirmed', 'likely', 'possible'],
          },
        },
        required: ['allergen', 'evidence', 'confidence'],
      },
      description: 'EU 14 major allergens observed or suspected with confidence.',
    },
    crossContactNotes: {
      type: 'array',
      items: { type: 'string' },
      description: 'Shared fryers, cutting boards, or facility cross-contact warnings.',
    },
    sodiumSources: {
      type: 'array',
      items: { type: 'string' },
      description: 'High sodium ingredients such as soy sauce, bouillon, cured meats, table salt.',
    },
    nutritionSignals: {
      type: 'array',
      items: {
        type: 'string',
        enum: [...KNOWN_NUTRITION_SIGNALS],
      },
    },
    restrictionTags: {
      type: 'array',
      items: {
        type: 'string',
        enum: [...KNOWN_RESTRICTION_TAGS],
      },
    },
    summary: {
      type: 'string',
      description: 'Concise summary of the dish, nutrition fit, and prep style.',
    },
    coverage: {
      type: 'string',
      enum: ['full', 'partial'],
      description: 'Whether the full recipe/ingredients could be confidently observed.',
    },
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
