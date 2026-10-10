import { checkTime, HealthGoal, matchGoals } from '../meal-plan/profile-fit';
import { FeedbackMap } from '../users/feedback';
import { VideoAnalysis } from '../videos/analyzers/analysis.schema';
import { restrictionCoverage } from './restrictions';

/**
 * What "good" means, in one place. The agent prompt describes the same
 * priorities, and the fallback planner and the deterministic pipeline use
 * these numbers directly.
 */
export const RANKING_WEIGHTS = {
  restrictionMatched: 2,
  restrictionMissing: -3,
  goalMatched: 2,
  goalMissing: -1,
  fullCoverage: 2,
  trustedChannel: 1.5,
  /** Multiplied by the share (0..1) of high-confidence ingredients. */
  highConfidenceShare: 2,
  fitsTime: 1,
  /** Per already-selected recipe with the same main protein. */
  repeatedProtein: -2,
  /** Per star away from a neutral 3: rated 5 adds 1.5, rated 2 subtracts 0.75. */
  userRating: 0.75,
} as const;

export interface RankingContext {
  restrictions?: string[];
  healthGoals?: HealthGoal[];
  maxCookMinutes?: number;
  isTrusted: (channelId: string | undefined) => boolean;
  /** The user's meal-log ratings. Rated-1 recipes are filtered out before ranking. */
  feedback?: FeedbackMap;
}

export type RankedAnalysis = Pick<
  VideoAnalysis,
  | 'videoId'
  | 'channelId'
  | 'restrictionTags'
  | 'nutritionSignals'
  | 'nutrition'
  | 'coverage'
  | 'ingredients'
  | 'prepMinutes'
  | 'mainProtein'
>;

export interface RecipeScore {
  score: number;
  breakdown: Partial<Record<keyof typeof RANKING_WEIGHTS, number>>;
}

const NO_PROTEIN_PENALTY = new Set(['none', 'other', undefined]);

export function scoreRecipe(
  analysis: RankedAnalysis,
  ctx: RankingContext,
  alreadySelected: Pick<VideoAnalysis, 'mainProtein'>[] = [],
): RecipeScore {
  const w = RANKING_WEIGHTS;
  const breakdown: RecipeScore['breakdown'] = {};
  const add = (key: keyof typeof RANKING_WEIGHTS, value: number) => {
    if (value !== 0) breakdown[key] = (breakdown[key] ?? 0) + value;
  };

  const restrictions = restrictionCoverage(analysis, ctx.restrictions);
  add('restrictionMatched', restrictions.matched.length * w.restrictionMatched);
  add('restrictionMissing', restrictions.missing.length * w.restrictionMissing);

  const goals = matchGoals(analysis, ctx.healthGoals);
  add('goalMatched', goals.matched.length * w.goalMatched);
  add('goalMissing', goals.missing.length * w.goalMissing);

  if (analysis.coverage === 'full') add('fullCoverage', w.fullCoverage);
  if (ctx.isTrusted(analysis.channelId)) add('trustedChannel', w.trustedChannel);

  const ingredients = analysis.ingredients ?? [];
  if (ingredients.length) {
    const high = ingredients.filter((i) => i.confidence === 'high').length;
    add('highConfidenceShare', Math.round((high / ingredients.length) * w.highConfidenceShare * 100) / 100);
  }

  if (checkTime(analysis, ctx.maxCookMinutes).fitsTime === true) add('fitsTime', w.fitsTime);

  const rating = ctx.feedback?.get(analysis.videoId)?.userRating;
  if (rating !== undefined) add('userRating', (rating - 3) * w.userRating);

  if (!NO_PROTEIN_PENALTY.has(analysis.mainProtein)) {
    const repeats = alreadySelected.filter((s) => s.mainProtein === analysis.mainProtein).length;
    add('repeatedProtein', repeats * w.repeatedProtein);
  }

  const score = Object.values(breakdown).reduce((sum, v) => sum + (v ?? 0), 0);
  return { score: Math.round(score * 100) / 100, breakdown };
}

/**
 * Greedy selection: pick the best-scoring recipe, then re-score the rest
 * with the protein penalty for what is already picked. Callers pass only
 * candidates that already passed the safety and time gates.
 */
export function selectRanked<T extends RankedAnalysis>(
  candidates: T[],
  ctx: RankingContext,
  max: number,
): Array<{ analysis: T; score: RecipeScore }> {
  const remaining = [...candidates];
  const picked: Array<{ analysis: T; score: RecipeScore }> = [];
  while (picked.length < max && remaining.length) {
    let bestIdx = 0;
    let best = scoreRecipe(remaining[0], ctx, picked.map((p) => p.analysis));
    for (let i = 1; i < remaining.length; i++) {
      const s = scoreRecipe(remaining[i], ctx, picked.map((p) => p.analysis));
      if (s.score > best.score) {
        best = s;
        bestIdx = i;
      }
    }
    picked.push({ analysis: remaining[bestIdx], score: best });
    remaining.splice(bestIdx, 1);
  }
  return picked;
}
