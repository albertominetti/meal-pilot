import { HealthGoal } from '../meal-plan/profile-fit';
import { VideoAnalysis } from '../videos/analyzers/analysis.schema';
import { byWeight, formatIngredient, isUnclear } from './ingredient-format';

export interface GoalEvidence {
  goal: HealthGoal;
  ingredients: string[];
  note?: string;
}

export interface RecommendationEvidence {
  goals: GoalEvidence[];
  allergens: string;
  /** Goals are matched on model-estimated signals until nutrients are computed. */
  basis: 'model-signals';
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
  return {
    goals: matchedGoals.map((g) => goalIngredients(analysis, g)),
    allergens: verdict.notes,
    basis: 'model-signals',
  };
}
