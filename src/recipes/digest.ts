import { sanitizeUntrusted } from '../common/untrusted-text';
import { checkTime, HealthGoal, matchGoals } from '../meal-plan/profile-fit';
import { VideoAnalysis } from '../videos/analyzers/analysis.schema';
import { byWeight, formatIngredient, isUnclear } from './ingredient-format';

export const MAX_DIGEST_BYTES = 1500;

export interface VideoDigest {
  videoId: string;
  title: string;
  channel: string;
  trustedChannel: boolean;
  recipeName: string;
  mainProtein?: string;
  cuisine?: string;
  mealType: string[];
  prepMinutes: number | null;
  servings: number | null;
  /** Prefer 'full': 'partial' means ingredients or steps were missed. */
  coverage: 'full' | 'partial';
  keyIngredients: string[];
  lowConfidenceIngredients: string[];
  restrictionTags: string[];
  /** Model estimates, not measured nutrients. */
  estimatedSignals: string[];
  matchedGoals: string[];
  labelCheck: string[];
  allergySafety: { status: 'safe' | 'uncertain' | 'unsafe'; notes: string };
  fitsTime: boolean | null;
  score?: number;
}

export interface DigestContext {
  verdict: { status: 'safe' | 'uncertain' | 'unsafe'; notes: string };
  trusted: boolean;
  maxCookMinutes?: number;
  healthGoals?: HealthGoal[];
  score?: number;
}

/**
 * Compact, size-capped view of an analysis for the agent's context window.
 * Every string comes from the video or its description, so it is untrusted:
 * control characters are stripped and each field is length-capped. Digests
 * belong in tool results only, never in the system prompt.
 */
export function buildDigest(analysis: VideoAnalysis, ctx: DigestContext): VideoDigest {
  const clean = (s: string | undefined, max: number) => sanitizeUntrusted(s, max);
  const ordered = byWeight(analysis.ingredients ?? []);

  const digest: VideoDigest = {
    videoId: analysis.videoId,
    title: clean(analysis.title, 120),
    channel: clean(analysis.channel, 60),
    trustedChannel: ctx.trusted,
    recipeName: clean(analysis.recipeName, 100),
    mainProtein: analysis.mainProtein,
    cuisine: analysis.cuisine ? clean(analysis.cuisine, 30) : undefined,
    mealType: analysis.mealType ?? [],
    prepMinutes: analysis.prepMinutes ?? null,
    servings: analysis.servings ?? null,
    coverage: analysis.coverage,
    keyIngredients: ordered.filter((i) => !isUnclear(i)).slice(0, 10).map(formatIngredient),
    lowConfidenceIngredients: ordered.filter(isUnclear).slice(0, 5).map(formatIngredient),
    restrictionTags: analysis.restrictionTags ?? [],
    estimatedSignals: analysis.nutritionSignals ?? [],
    matchedGoals: matchGoals(analysis, ctx.healthGoals).matched,
    labelCheck: (analysis.labelCheck ?? []).slice(0, 5).map((l) => clean(l, 40)),
    allergySafety: { status: ctx.verdict.status, notes: clean(ctx.verdict.notes, 300) },
    fitsTime: checkTime(analysis, ctx.maxCookMinutes).fitsTime,
    ...(ctx.score !== undefined ? { score: ctx.score } : {}),
  };
  return shrinkToFit(digest);
}

function size(d: VideoDigest): number {
  return Buffer.byteLength(JSON.stringify(d), 'utf8');
}

/** Drops the least important detail first until the digest fits. */
function shrinkToFit(d: VideoDigest): VideoDigest {
  const steps: Array<(x: VideoDigest) => void> = [
    (x) => (x.lowConfidenceIngredients = x.lowConfidenceIngredients.slice(0, 2)),
    (x) => (x.keyIngredients = x.keyIngredients.slice(0, 6)),
    (x) => (x.allergySafety.notes = sanitizeUntrusted(x.allergySafety.notes, 150)),
    (x) => (x.labelCheck = x.labelCheck.slice(0, 2)),
    (x) => (x.lowConfidenceIngredients = []),
    (x) => (x.keyIngredients = x.keyIngredients.slice(0, 3)),
    (x) => (x.title = sanitizeUntrusted(x.title, 60)),
  ];
  for (const step of steps) {
    if (size(d) <= MAX_DIGEST_BYTES) break;
    step(d);
  }
  return d;
}
