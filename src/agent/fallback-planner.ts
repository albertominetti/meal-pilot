import { Injectable } from '@nestjs/common';
import { checkTime } from '../meal-plan/profile-fit';
import { AcceptedPlan, AcceptedRecommendation, AgentRun } from './agent-run';

@Injectable()
export class FallbackPlanner {
  build(run: AgentRun): AcceptedPlan {
    const max = run.request.maxResults ?? 5;
    const recommendations: AcceptedRecommendation[] = [];

    for (const [videoId, analysis] of run.analyzedVideos) {
      if (recommendations.length >= max) break;
      const verdict = run.videoSafetyVerdicts.get(videoId);
      const time = checkTime(analysis, run.request.maxCookMinutes);
      if (verdict?.status === 'safe' && time.fitsTime !== false) {
        const whyItFits =
          analysis.summary ||
          `Matches requested diet restrictions (${(run.request.restrictions || []).join(', ')}) with safe allergen profile.`;
        recommendations.push({
          videoId,
          whyItFits,
          healthNotes: `Estimated signals (model, not measured): ${(analysis.nutritionSignals || []).join(', ') || 'whole-foods'}`,
        });
      }
    }

    return {
      recommendations,
      notes: 'Plan constructed by fallback planner from verified safe recipe analyses.',
    };
  }
}
