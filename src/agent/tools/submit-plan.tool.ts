import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AgentRun } from '../agent-run';
import { AgentTool } from './tool.interface';

const recommendationItemSchema = z.object({
  videoId: z.string().describe('The YouTube video ID'),
  whyItFits: z
    .string()
    .min(5)
    .describe('Detailed explanation of why this dish fits the users goals and restrictions'),
  healthNotes: z
    .string()
    .optional()
    .describe('Optional health context (e.g. sodium level, protein, substitutions)'),
});

const submitPlanArgsSchema = z.object({
  recommendations: z
    .array(recommendationItemSchema)
    .min(1)
    .describe('Final recommended meal recipes'),
  notes: z
    .string()
    .optional()
    .describe('Overall summary notes for the meal plan'),
});
type SubmitPlanArgs = z.infer<typeof submitPlanArgsSchema>;

@Injectable()
export class SubmitPlanTool implements AgentTool<SubmitPlanArgs> {
  name = 'submit_plan';
  description =
    'Submit the validated meal plan recommendations. This is the terminal tool call once you have sufficient safe recommendations.';

  parameters: Record<string, unknown> = {
    type: 'object',
    properties: {
      recommendations: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            videoId: { type: 'string' },
            whyItFits: { type: 'string' },
            healthNotes: { type: 'string' },
          },
          required: ['videoId', 'whyItFits'],
        },
        description: 'Recommended video recipes that passed safety checks',
      },
      notes: {
        type: 'string',
        description: 'Plan notes or tips for the user',
      },
    },
    required: ['recommendations'],
  };

  zodSchema = submitPlanArgsSchema;

  async execute(
    args: SubmitPlanArgs,
    run: AgentRun,
  ): Promise<Record<string, unknown>> {
    const maxResults = run.request.maxResults ?? 5;
    const errors: string[] = [];
    const seenIds = new Set<string>();

    if (args.recommendations.length > maxResults) {
      errors.push(
        `Plan has ${args.recommendations.length} recommendations, exceeding maxResults limit of ${maxResults}.`,
      );
    }

    for (const rec of args.recommendations) {
      if (seenIds.has(rec.videoId)) {
        errors.push(`Duplicate video ID ${rec.videoId} in plan.`);
      }
      seenIds.add(rec.videoId);

      const analysis = run.analyzedVideos.get(rec.videoId);
      if (!analysis) {
        errors.push(
          `Video ${rec.videoId} was not analyzed in this session. Only analyzed videos can be submitted.`,
        );
        continue;
      }

      const verdict = run.videoSafetyVerdicts.get(rec.videoId);
      if (!verdict || verdict.status !== 'safe') {
        errors.push(
          `Video ${rec.videoId} is not safe (verdict: ${verdict?.status || 'unverified'}). Reason: ${verdict?.notes || 'Unknown'}. Only safe recipes may be recommended.`,
        );
      }
    }

    if (errors.length > 0) {
      return {
        accepted: false,
        errors,
        instruction:
          'Please correct the plan errors: replace or remove unsafe/unanalyzed videos and call submit_plan again.',
      };
    }

    run.acceptedPlan = {
      recommendations: args.recommendations,
      notes: args.notes,
    };

    return {
      accepted: true,
      count: args.recommendations.length,
      message: 'Plan successfully accepted and validated.',
    };
  }
}
