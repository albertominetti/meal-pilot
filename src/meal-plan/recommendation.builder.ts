import { buildEvidence } from '../recipes/evidence';
import { VideoAnalysis } from '../videos/analyzers/analysis.schema';
import { watchUrl } from '../videos/youtube.util';
import { labelCheckFields, RecipeDto, RecommendationDto } from './dto/meal-plan-response.dto';
import { MealPlanRequestDto } from './dto/meal-plan-request.dto';
import { checkTime, matchGoals } from './profile-fit';

export function toRecipe(analysis: VideoAnalysis): RecipeDto {
  return {
    recipeName: analysis.recipeName,
    servings: analysis.servings,
    prepMinutes: analysis.prepMinutes,
    mainProtein: analysis.mainProtein,
    cuisine: analysis.cuisine,
    mealType: analysis.mealType ?? [],
    coverage: analysis.coverage,
    ingredients: analysis.ingredients ?? [],
    steps: analysis.steps ?? [],
    labelCheck: analysis.labelCheck ?? [],
    estimatedNutritionSignals: analysis.nutritionSignals ?? [],
  };
}

export interface RecommendationInput {
  analysis: VideoAnalysis;
  verdict: { status: 'safe' | 'uncertain' | 'unsafe'; notes: string };
  whyItFits: string;
  healthNotes: string;
  matchedTags: string[];
  request: MealPlanRequestDto;
  trusted: boolean;
}

/** One shape for both endpoints: model text plus server-built recipe and evidence. */
export function buildRecommendation(input: RecommendationInput): RecommendationDto {
  const { analysis, request } = input;
  const goals = matchGoals(analysis, request.healthGoals);
  return {
    videoId: analysis.videoId,
    url: watchUrl(analysis.videoId),
    title: analysis.title,
    channel: analysis.channel,
    whyItFits: input.whyItFits,
    matchedTags: input.matchedTags,
    allergySafety: input.verdict,
    healthNotes: input.healthNotes,
    ...labelCheckFields(analysis),
    trustedChannel: input.trusted,
    fitsTime: checkTime(analysis, request.maxCookMinutes).fitsTime,
    recipe: toRecipe(analysis),
    evidence: buildEvidence(analysis, goals.matched, input.verdict),
  };
}
