import { MealLog } from './user-data.store';

export interface VideoFeedback {
  /** The latest rating the user gave this recipe (1-5), if any. */
  userRating?: number;
  cookedCount: number;
}

export type FeedbackMap = Map<string, VideoFeedback>;

/** Recipes rated this low are never recommended to the user again. */
export const EXCLUDED_RATING = 1;
/** The prompt asks the agent to avoid recipes rated at or below this. */
export const AVOID_RATING = 2;

export function feedbackFrom(meals: MealLog[]): FeedbackMap {
  const out: FeedbackMap = new Map();
  const ordered = [...meals].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const m of ordered) {
    const entry = out.get(m.videoId) ?? { cookedCount: 0 };
    if (m.cooked) entry.cookedCount++;
    if (m.rating !== null && m.rating !== undefined) entry.userRating = m.rating;
    out.set(m.videoId, entry);
  }
  return out;
}

export function isExcludedByRating(feedback: FeedbackMap | undefined, videoId: string): boolean {
  return feedback?.get(videoId)?.userRating === EXCLUDED_RATING;
}
