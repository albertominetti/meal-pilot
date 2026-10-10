import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AgentRun } from '../agent-run';
import { AgentTool } from './tool.interface';

const checkFitArgsSchema = z.object({
  videoId: z.string().describe('The analyzed video ID to check for profile alignment'),
});
type CheckFitArgs = z.infer<typeof checkFitArgsSchema>;

@Injectable()
export class CheckProfileFitTool implements AgentTool<CheckFitArgs> {
  name = 'check_profile_fit';
  description =
    'Deterministic check comparing an analyzed video against the user requested dietary restrictions and health profile.';

  parameters: Record<string, unknown> = {
    type: 'object',
    properties: {
      videoId: {
        type: 'string',
        description: 'Analyzed video ID',
      },
    },
    required: ['videoId'],
  };

  zodSchema = checkFitArgsSchema;

  async execute(
    args: CheckFitArgs,
    run: AgentRun,
  ): Promise<Record<string, unknown>> {
    const analysis = run.analyzedVideos.get(args.videoId);
    if (!analysis) {
      return {
        error: `Video ${args.videoId} has not been analyzed yet. Please call analyze_video first.`,
      };
    }

    const requestedRestrictions = (run.request.restrictions || []).map((r) =>
      r.toLowerCase().replace(/\s+/g, '-'),
    );

    const videoTags = new Set<string>([
      ...(analysis.restrictionTags || []),
      ...(analysis.nutritionSignals || []),
    ]);

    const matchedRestrictions = requestedRestrictions.filter((r) =>
      videoTags.has(r),
    );
    const missingRestrictions = requestedRestrictions.filter(
      (r) => !videoTags.has(r),
    );

    const safety = run.videoSafetyVerdicts.get(args.videoId);

    return {
      videoId: args.videoId,
      recipeName: analysis.recipeName,
      safetyStatus: safety?.status ?? 'unknown',
      matchedRestrictions,
      missingRestrictions,
      signals: analysis.nutritionSignals,
      sodiumSources: analysis.sodiumSources,
      coverage: analysis.coverage,
      fitsUserRestrictions: missingRestrictions.length === 0,
    };
  }
}
