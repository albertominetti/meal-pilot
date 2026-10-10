import { Injectable } from '@nestjs/common';
import { checkTime } from '../meal-plan/profile-fit';
import { nutritionNote } from '../nutrition/nutrition-note';
import { isExcludedByRating } from '../users/feedback';
import { selectRanked } from '../recipes/ranking';
import { AcceptedPlan, AgentRun } from './agent-run';
import { RunDigestService } from './run-digest.service';

/**
 * Used when the agent ends without an accepted plan. Applies the same gates
 * as submit_plan (safe, within the time limit) and the shared ranking.
 */
@Injectable()
export class FallbackPlanner {
  constructor(private readonly digests: RunDigestService) {}

  build(run: AgentRun): AcceptedPlan {
    const max = run.request.maxResults ?? 5;
    const eligible = [...run.analyzedVideos.values()].filter(
      (a) =>
        a.status === 'ok' &&
        !run.excludedVideoIds.has(a.videoId) &&
        !isExcludedByRating(run.feedback, a.videoId) &&
        run.videoSafetyVerdicts.get(a.videoId)?.status === 'safe' &&
        checkTime(a, run.request.maxCookMinutes).fitsTime !== false,
    );

    const ranked = selectRanked(eligible, this.digests.rankingContext(run), max);
    return {
      recommendations: ranked.map(({ analysis }) => ({
        videoId: analysis.videoId,
        whyItFits:
          analysis.summary ||
          `Matches requested diet restrictions (${(run.request.restrictions || []).join(', ')}) with safe allergen profile.`,
        healthNotes: nutritionNote(analysis),
      })),
      notes: 'Plan constructed by fallback planner from verified safe recipe analyses, ranked by profile fit.',
    };
  }
}
