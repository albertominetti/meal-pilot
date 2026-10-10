import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  IYouTubeService,
  YOUTUBE_SERVICE,
} from '../../youtube/youtube.interface';
import { AgentRun } from '../agent-run';
import { AgentTool } from './tool.interface';

const searchVideosArgsSchema = z.object({
  query: z.string().describe('Targeted recipe search query'),
  maxResults: z.number().int().min(1).max(10).optional().default(5),
});
type SearchVideosArgs = z.infer<typeof searchVideosArgsSchema>;

@Injectable()
export class SearchVideosTool implements AgentTool<SearchVideosArgs> {
  name = 'search_videos';
  description =
    'Search YouTube for public cooking and recipe videos (4-20 minutes). Uses search budget.';

  parameters: Record<string, unknown> = {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Specific recipe query incorporating preferences and restrictions',
      },
      maxResults: {
        type: 'integer',
        minimum: 1,
        maximum: 10,
        default: 5,
        description: 'Number of videos to discover (max 10)',
      },
    },
    required: ['query'],
  };

  zodSchema = searchVideosArgsSchema;

  constructor(
    @Inject(YOUTUBE_SERVICE) private readonly youtube: IYouTubeService,
  ) {}

  async execute(
    args: SearchVideosArgs,
    run: AgentRun,
  ): Promise<Record<string, unknown>> {
    if (run.searchCount >= run.budgets.maxSearches) {
      return {
        error: `Search budget exhausted (${run.searchCount}/${run.budgets.maxSearches} used). Proceed with existing videos or list_known_videos.`,
      };
    }

    run.searchCount++;

    try {
      const ids = await this.youtube.search(args.query, {
        maxResults: args.maxResults,
      });

      if (ids.length === 0) {
        return {
          query: args.query,
          found: 0,
          videos: [],
          remainingSearches: run.budgets.maxSearches - run.searchCount,
        };
      }

      const details = await this.youtube.getDetails(ids);
      const results = details.map((d) => ({
        videoId: d.videoId,
        title: d.title,
        channel: d.channel,
        durationSec: d.durationSec,
        alreadyAnalyzed: run.analyzedVideos.has(d.videoId),
      }));

      return {
        query: args.query,
        found: results.length,
        videos: results,
        remainingSearches: run.budgets.maxSearches - run.searchCount,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        error: `Search failed: ${msg}`,
        remainingSearches: run.budgets.maxSearches - run.searchCount,
      };
    }
  }
}
