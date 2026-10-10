import { Injectable } from '@nestjs/common';
import { buildDigest, VideoDigest } from '../recipes/digest';
import { RankingContext, scoreRecipe } from '../recipes/ranking';
import { VideoAnalysis } from '../videos/analyzers/analysis.schema';
import { TrustedChannelsService } from '../youtube/trusted-channels.service';
import { AgentRun } from './agent-run';

/** Builds digests and ranking context from the run's request profile. */
@Injectable()
export class RunDigestService {
  constructor(private readonly trustedChannels: TrustedChannelsService) {}

  rankingContext(run: AgentRun): RankingContext {
    return {
      restrictions: run.request.restrictions,
      healthGoals: run.request.healthGoals,
      maxCookMinutes: run.request.maxCookMinutes,
      isTrusted: (id) => this.trustedChannels.isTrusted(id),
      feedback: run.feedback,
    };
  }

  digest(run: AgentRun, analysis: VideoAnalysis): VideoDigest {
    const verdict = run.videoSafetyVerdicts.get(analysis.videoId) ?? {
      status: 'uncertain' as const,
      notes: 'Not yet checked',
    };
    return buildDigest(analysis, {
      verdict,
      trusted: this.trustedChannels.isTrusted(analysis.channelId),
      maxCookMinutes: run.request.maxCookMinutes,
      healthGoals: run.request.healthGoals,
      feedback: run.feedback.get(analysis.videoId),
      score: scoreRecipe(analysis, this.rankingContext(run)).score,
    });
  }
}
