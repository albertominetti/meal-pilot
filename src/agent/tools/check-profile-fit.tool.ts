import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { checkTime, matchGoals } from '../../meal-plan/profile-fit';
import { nutritionFacts } from '../../nutrition/nutrition-facts';
import { restrictionCoverage } from '../../recipes/restrictions';
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
    'Deterministic check comparing an analyzed video against the user requested dietary restrictions, health goals and cooking-time limit.';

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

    const restrictions = restrictionCoverage(analysis, run.request.restrictions);
    const facts = nutritionFacts(analysis);

    const safety = run.videoSafetyVerdicts.get(args.videoId);
    const goals = matchGoals(analysis, run.request.healthGoals);
    const time = checkTime(analysis, run.request.maxCookMinutes);

    return {
      videoId: args.videoId,
      recipeName: analysis.recipeName,
      safetyStatus: safety?.status ?? 'unknown',
      matchedRestrictions: restrictions.matched,
      missingRestrictions: restrictions.missing,
      signals: facts.signals,
      nutritionBasis: facts.basis,
      nutrientsPerServing: facts.perServing,
      sodiumSources: analysis.sodiumSources,
      coverage: analysis.coverage,
      fitsUserRestrictions: restrictions.missing.length === 0,
      matchedGoals: goals.matched,
      missingGoals: goals.missing,
      unverifiableGoals: goals.unverifiable,
      prepMinutes: analysis.prepMinutes ?? null,
      fitsTime: time.fitsTime,
      timeNote: time.note,
    };
  }
}
