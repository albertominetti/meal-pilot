import { HealthGoal } from '../meal-plan/profile-fit';
import { nutritionFacts, SIGNAL_NUTRIENT } from '../nutrition/nutrition-facts';
import { NutrientTotals } from '../nutrition/nutrition';
import { VideoAnalysis } from '../videos/analyzers/analysis.schema';
import { byWeight, formatIngredient, isUnclear } from './ingredient-format';

export interface GoalEvidence {
  goal: HealthGoal;
  ingredients: string[];
  note?: string;
}

export type EvidenceBasis = 'nutrients' | 'model-signals' | 'none';

export interface RecommendationEvidence {
  goals: GoalEvidence[];
  allergens: string;
  /** nutrients: goals matched on USDA-based nutrients; model-signals: on Gemini estimates. */
  basis: EvidenceBasis;
}

const UNITS: Record<string, string> = { sodium: 'mg', kcal: 'kcal' };

function nutrientNote(goal: HealthGoal, perServing: NutrientTotals): string | undefined {
  const key = SIGNAL_NUTRIENT[goal];
  if (!key) return undefined;
  return `${perServing[key]} ${UNITS[key] ?? 'g'} ${key === 'carbs' ? 'carbohydrate' : key} per serving (USDA estimate)`;
}

const GOAL_INGREDIENTS: Partial<Record<HealthGoal, RegExp>> = {
  'high-protein':
    /chickpea|lentil|bean|tofu|tempeh|egg|chicken|beef|pork|turkey|fish|salmon|tuna|cod|shrimp|prawn|yogh?urt|cheese|quinoa|seitan|edamame|peanut|almond|cashew|walnut|seed/,
  'high-fiber':
    /lentil|bean|chickpea|\bpea|oat|quinoa|brown rice|whole|barley|bulgur|broccoli|carrot|kale|spinach|vegetable|cabbage|apple|berr|seed/,
};

const STARCH = /rice|pasta|bread|potato|noodle|sugar|flour|tortilla|couscous/;

function goalIngredients(analysis: VideoAnalysis, goal: HealthGoal): GoalEvidence {
  const ingredients = byWeight(analysis.ingredients ?? []);
  const pattern = GOAL_INGREDIENTS[goal];
  if (pattern) {
    return {
      goal,
      ingredients: ingredients
        .filter((i) => pattern.test(i.name) && !isUnclear(i))
        .slice(0, 3)
        .map(formatIngredient),
    };
  }
  if (goal === 'low-sodium') {
    const sources = analysis.sodiumSources ?? [];
    return {
      goal,
      ingredients: [],
      note: sources.length
        ? `Sodium sources to watch: ${sources.slice(0, 3).join(', ')}`
        : 'No concentrated sodium sources found in the recipe',
    };
  }
  if (goal === 'low-carb') {
    const starches = ingredients.filter((i) => STARCH.test(i.name));
    return {
      goal,
      ingredients: starches.slice(0, 3).map(formatIngredient),
      note: starches.length ? 'Starchy ingredients present' : 'No starchy staples found',
    };
  }
  return { goal, ingredients: [] };
}

/**
 * Server-side evidence attached to each accepted recommendation, shown next
 * to the model's whyItFits text.
 */
export function buildEvidence(
  analysis: VideoAnalysis,
  matchedGoals: HealthGoal[],
  verdict: { notes: string },
): RecommendationEvidence {
  const facts = nutritionFacts(analysis);
  const goals = matchedGoals.map((g) => {
    const evidence = goalIngredients(analysis, g);
    const note = facts.perServing ? nutrientNote(g, facts.perServing) : undefined;
    return note ? { ...evidence, note: evidence.note ? `${note}. ${evidence.note}` : note } : evidence;
  });
  const basis: EvidenceBasis =
    facts.basis === 'nutrients' ? 'nutrients' : facts.basis === 'model' ? 'model-signals' : 'none';
  return { goals, allergens: verdict.notes, basis };
}
