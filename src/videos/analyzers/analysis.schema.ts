import { z } from 'zod';
import type { NutritionResult } from '../../nutrition/nutrition';
import { CANONICAL_ALLERGENS } from '../allergy.util';

export const ANALYSIS_SCHEMA_VERSION = 3;

export const INGREDIENT_UNITS = [
  'g',
  'kg',
  'ml',
  'l',
  'tsp',
  'tbsp',
  'cup',
  'piece',
  'can',
  'clove',
  'pinch',
  'bunch',
  'slice',
] as const;
export type Unit = (typeof INGREDIENT_UNITS)[number];

export const MAIN_PROTEINS = [
  'chickpea',
  'lentil',
  'bean',
  'tofu',
  'tempeh',
  'egg',
  'dairy',
  'chicken',
  'beef',
  'pork',
  'fish',
  'seafood',
  'none',
  'other',
] as const;
export type MainProtein = (typeof MAIN_PROTEINS)[number];

export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
export type MealType = (typeof MEAL_TYPES)[number];

export const INGREDIENT_CONFIDENCE = ['high', 'medium', 'low'] as const;
export type IngredientConfidence = (typeof INGREDIENT_CONFIDENCE)[number];

export const INGREDIENT_SOURCES = ['video', 'description', 'both'] as const;
export type IngredientSource = (typeof INGREDIENT_SOURCES)[number];

export const KNOWN_NUTRITION_SIGNALS = [
  'low-sodium',
  'moderate-sodium',
  'low-carb',
  'high-protein',
  'high-fiber',
  'low-sugar',
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
  name: z.string().describe('Normalised, singular ingredient name (e.g. chickpea)'),
  quantity: z.number().nullable().describe('Numeric quantity or null if unspecified/unclear'),
  unit: z.enum(INGREDIENT_UNITS).nullable().describe('Unit from allowed enum, or null if custom/unmatched'),
  rawText: z.string().describe('Ingredient as spoken or shown, e.g. "a big splash of olive oil"'),
  confidence: z.enum(INGREDIENT_CONFIDENCE),
  source: z.enum(INGREDIENT_SOURCES),
  packaged: z.boolean().describe('True if store-bought product (curry paste, pesto, broth/stock)'),
  timestamp: z.string().optional(),
});
export type Ingredient = z.infer<typeof IngredientSchema>;

export const AnalysisOutputSchema = z.object({
  recipeName: z.string(),
  servings: z.number().optional(),
  durationSec: z.number().optional(),
  prepMinutes: z.number().optional().describe('Total active and passive cooking time in minutes'),
  mainProtein: z.enum(MAIN_PROTEINS).optional(),
  cuisine: z.string().optional().describe('Short cuisine descriptor, e.g. "indian", "italian"'),
  mealType: z.array(z.enum(MEAL_TYPES)).default(['dinner']),
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
  channelId?: string;
  status: 'ok' | 'unavailable';
  error?: string;
  provider: 'gemini' | 'mock';
  model: string;
  analyzedAt: string;
  schemaVersion: number;
  /** Packaged ingredients whose label the user should check for allergens. */
  labelCheck: string[];
  /**
   * nutritionSignals are Gemini estimates kept from analyses made before
   * nutrients were computed; Gemini no longer produces them. Use
   * nutritionFacts() rather than reading either field directly.
   */
  nutritionSignalsSource: 'model';
  /**
   * Computed from USDA FoodData Central after analysis. Undefined when not
   * computed (FDC disabled), null when FDC was unavailable this time.
   */
  nutrition?: NutritionResult | null;
  // Computed helpers for backwards-compatibility:
  transcript: string;
  detectedAllergens: string[];
}

export const LABEL_CHECK_NOTE = 'Check the product label for allergens';

/** Names of store-bought ingredients (sauces, stock, pastes), deduplicated. */
export function deriveLabelCheck(ingredients: Ingredient[]): string[] {
  return [
    ...new Set(
      ingredients.filter((i) => i.packaged).map((i) => i.name.trim()),
    ),
  ].filter(Boolean);
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
    prepMinutes: {
      type: 'number',
      description: 'Total active + passive prep and cooking time in minutes if discernible.',
    },
    mainProtein: {
      type: 'string',
      enum: MAIN_PROTEINS as unknown as string[],
      description: 'Primary protein source in the recipe.',
    },
    cuisine: {
      type: 'string',
      description: 'Short cuisine classification, e.g. "indian", "italian", "mexican".',
    },
    mealType: {
      type: 'array',
      items: { type: 'string', enum: MEAL_TYPES as unknown as string[] },
      description: 'Suitable meal types: breakfast, lunch, dinner, snack.',
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
          name: { type: 'string', description: 'Normalized singular ingredient name' },
          quantity: { type: ['number', 'null'], description: 'Numeric amount or null' },
          unit: {
            type: ['string', 'null'],
            enum: [...INGREDIENT_UNITS, null],
            description: 'Unit enum value or null if unmapped',
          },
          rawText: { type: 'string', description: 'Raw spoken or written phrase' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          source: { type: 'string', enum: ['video', 'description', 'both'] },
          packaged: { type: 'boolean', description: 'True if store-bought processed product' },
          timestamp: { type: 'string' },
        },
        required: ['name', 'rawText', 'confidence', 'source', 'packaged'],
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
            enum: CANONICAL_ALLERGENS as unknown as string[],
          },
          evidence: {
            type: 'string',
            description: "Spoken or visual timestamped evidence (e.g. '01:23: adds sesame oil')",
          },
          timestamp: { type: 'string' },
          confidence: {
            type: 'string',
            enum: ['confirmed', 'likely', 'possible'],
          },
        },
        required: ['allergen', 'evidence', 'confidence'],
      },
      description: 'Detected EU 14 allergens with timestamp/spoken evidence.',
    },
    crossContactNotes: {
      type: 'array',
      items: { type: 'string' },
      description: 'Potential cross-contact risks or shared equipment mentions.',
    },
    sodiumSources: {
      type: 'array',
      items: { type: 'string' },
      description: 'Concentrated sodium sources (e.g. soy sauce, bullion, canned broth).',
    },
    restrictionTags: {
      type: 'array',
      items: {
        type: 'string',
        enum: KNOWN_RESTRICTION_TAGS as unknown as string[],
      },
      description: 'Dietary restriction tags that accurately apply to this recipe.',
    },
    summary: {
      type: 'string',
      description: 'Short objective summary of what was prepared and key qualities.',
    },
    coverage: {
      type: 'string',
      enum: ['full', 'partial'],
      description: "'full' if all ingredients/steps observed, 'partial' if incomplete.",
    },
  },
  required: [
    'recipeName',
    'ingredients',
    'steps',
    'allergens',
    'summary',
  ],
};
