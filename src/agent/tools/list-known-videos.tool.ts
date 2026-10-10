import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { MealPlanService } from '../../meal-plan/meal-plan.service';
import { TranscriptCacheService } from '../../videos/transcript-cache.service';
import { AgentRun } from '../agent-run';
import { AgentTool } from './tool.interface';

const listKnownArgsSchema = z.object({
  tags: z.array(z.string()).optional(),
});
type ListKnownArgs = z.infer<typeof listKnownArgsSchema>;

@Injectable()
export class ListKnownVideosTool implements AgentTool<ListKnownArgs> {
  name = 'list_known_videos';
  description =
    'Inspect previously analyzed and cached recipe videos. Cost-free: reuse these videos to save analysis and search budget.';

  parameters: Record<string, unknown> = {
    type: 'object',
    properties: {
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional filter tags (e.g. "vegan", "low-sodium")',
      },
    },
  };

  zodSchema = listKnownArgsSchema;

  constructor(
    private readonly cache: TranscriptCacheService,
    private readonly mealPlanService: MealPlanService,
  ) {}

  async execute(
    args: ListKnownArgs,
    run: AgentRun,
  ): Promise<Record<string, unknown>> {
    const cachedItems = this.cache.list();
    const userAllergies = run.request.allergies ?? [];

    const results: Array<Record<string, unknown>> = [];
    for (const item of cachedItems) {
      if (item.status !== 'ok') continue;

      if (args.tags && args.tags.length > 0) {
        const itemTags = new Set<string>([
          ...(item.restrictionTags || []),
          ...(item.nutritionSignals || []),
        ]);
        const matchesTag = args.tags.some((t) => itemTags.has(t));
        if (!matchesTag) continue;
      }

      // Populate run state
      run.analyzedVideos.set(item.videoId, item);
      const verdict = this.mealPlanService.evaluateAllergySafety(
        item,
        userAllergies,
      );
      run.videoSafetyVerdicts.set(item.videoId, verdict);

      results.push({
        videoId: item.videoId,
        title: item.title,
        recipeName: item.recipeName,
        tags: item.restrictionTags,
        signals: item.nutritionSignals,
        allergySafetyStatus: verdict.status,
      });
    }

    return {
      count: results.length,
      videos: results.slice(0, 10),
    };
  }
}
