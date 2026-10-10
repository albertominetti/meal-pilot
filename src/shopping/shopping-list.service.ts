import { Injectable } from '@nestjs/common';
import { VideoAnalysis } from '../videos/analyzers/analysis.schema';
import { TranscriptCacheService } from '../videos/transcript-cache.service';
import { VideoAnalysisService } from '../videos/video-analysis.service';
import { ShoppingListRequestDto } from './dto/shopping-list.dto';
import { buildShoppingList, ShoppingList } from './shopping-list';

@Injectable()
export class ShoppingListService {
  constructor(
    private readonly cache: TranscriptCacheService,
    private readonly analysis: VideoAnalysisService,
  ) {}

  /** Builds the list from cached analyses only; never calls Gemini. */
  fromCache(dto: ShoppingListRequestDto): ShoppingList {
    const householdSize = dto.householdSize ?? 1;
    const missing: string[] = [];
    const inputs = dto.items.flatMap((item) => {
      const cached = this.findCached(item.videoId);
      if (!cached) {
        missing.push(item.videoId);
        return [];
      }
      return [{ analysis: cached, servings: item.servings }];
    });

    const list = buildShoppingList(inputs, householdSize);
    for (const id of missing) {
      list.warnings.unshift(`No analysis cached for ${id}; request a meal plan with it first.`);
    }
    return list;
  }

  private findCached(videoId: string): VideoAnalysis | null {
    const exact = this.cache.get(videoId, this.analysis.provider(), this.analysis.model());
    if (exact) return exact;
    return this.cache.list().find((a) => a.videoId === videoId && a.status === 'ok') ?? null;
  }
}
