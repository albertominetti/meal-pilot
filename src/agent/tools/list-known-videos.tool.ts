import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { MealPlanService } from '../../meal-plan/meal-plan.service';
import { ANALYSIS_STORE, AnalysisStore } from '../../videos/analysis-store';
import { VideoDigest } from '../../recipes/digest';
import { AgentRun } from '../agent-run';
import { RunDigestService } from '../run-digest.service';
import { AgentTool } from './tool.interface';

const listKnownArgsSchema = z.object({
  tags: z.array(z.string()).optional(),
});
type ListKnownArgs = z.infer<typeof listKnownArgsSchema>;

@Injectable()
export class ListKnownVideosTool implements AgentTool<ListKnownArgs> {
  name = 'list_known_videos';
  description =
    'Inspect previously analyzed and cached recipe videos as digests (best-ranked first, max 10). Cost-free: reuse these videos to save analysis and search budget.';

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
    @Inject(ANALYSIS_STORE) private readonly cache: AnalysisStore,
    private readonly mealPlanService: MealPlanService,
    private readonly digests: RunDigestService,
  ) {}

  async execute(
    args: ListKnownArgs,
    run: AgentRun,
  ): Promise<Record<string, unknown>> {
    const cachedItems = await this.cache.list();
    const userAllergies = run.request.allergies ?? [];

    const results: VideoDigest[] = [];
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

      results.push(this.digests.digest(run, item));
    }

    // Best-ranked first; at most 10 digests to protect the context window.
    results.sort((x, y) => (y.score ?? 0) - (x.score ?? 0));
    return {
      count: results.length,
      videos: results.slice(0, 10),
    };
  }
}
