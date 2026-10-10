import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { MealPlanService } from '../../meal-plan/meal-plan.service';
import { VideoAnalysisService } from '../../videos/video-analysis.service';
import { AgentRun } from '../agent-run';
import { RunDigestService } from '../run-digest.service';
import { AgentTool } from './tool.interface';

const analyzeVideoArgsSchema = z.object({
  videoId: z.string().describe('The YouTube video ID to analyze'),
  title: z.string().optional().describe('Video title if known'),
  channel: z.string().optional().describe('Channel name if known'),
});
type AnalyzeVideoArgs = z.infer<typeof analyzeVideoArgsSchema>;

@Injectable()
export class AnalyzeVideoTool implements AgentTool<AnalyzeVideoArgs> {
  name = 'analyze_video';
  description =
    'Analyze the actual cooking video (and its description) and return a digest: key ingredients with quantities, main protein, cuisine, prep time, coverage, fitsTime, label checks and the server-side allergy verdict. Uses analysis budget.';

  parameters: Record<string, unknown> = {
    type: 'object',
    properties: {
      videoId: {
        type: 'string',
        description: 'YouTube video ID to inspect and analyze',
      },
      title: { type: 'string', description: 'Title if known' },
      channel: { type: 'string', description: 'Channel name if known' },
    },
    required: ['videoId'],
  };

  zodSchema = analyzeVideoArgsSchema;

  constructor(
    private readonly analysisService: VideoAnalysisService,
    private readonly mealPlanService: MealPlanService,
    private readonly digests: RunDigestService,
  ) {}

  async execute(
    args: AnalyzeVideoArgs,
    run: AgentRun,
  ): Promise<Record<string, unknown>> {
    // If already analyzed in this run, return the digest from run memory
    if (run.analyzedVideos.has(args.videoId)) {
      const existing = run.analyzedVideos.get(args.videoId)!;
      return { ...this.digests.digest(run, existing), fromRunMemory: true };
    }

    if (run.analysisCount >= run.budgets.maxAnalyses) {
      return {
        error: `Analysis budget exhausted (${run.analysisCount}/${run.budgets.maxAnalyses} used). Do not analyze more videos. Select from already analyzed videos.`,
      };
    }

    const { analysis, fromCache } = await this.analysisService.analyzeWithMeta({
      videoId: args.videoId,
      title: args.title || `YouTube video ${args.videoId}`,
      channel: args.channel || 'Unknown channel',
    });

    if (!fromCache) {
      run.analysisCount++;
    }

    const verdict = this.mealPlanService.evaluateAllergySafety(
      analysis,
      run.request.allergies ?? [],
    );

    run.analyzedVideos.set(args.videoId, analysis);
    run.videoSafetyVerdicts.set(args.videoId, verdict);

    if (analysis.status === 'unavailable') {
      return {
        videoId: args.videoId,
        status: 'unavailable',
        error: analysis.error,
        allergySafety: verdict,
      };
    }

    return {
      ...this.digests.digest(run, analysis),
      remainingAnalyses: run.budgets.maxAnalyses - run.analysisCount,
    };
  }
}
