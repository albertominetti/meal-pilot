import { Inject, Injectable } from '@nestjs/common';
import { VideoAnalysis } from '../videos/analyzers/analysis.schema';
import { ANALYSIS_STORE, AnalysisStore } from '../videos/analysis-store';
import { VideoAnalysisService } from '../videos/video-analysis.service';
import { ShoppingListRequestDto } from './dto/shopping-list.dto';
import { buildShoppingList, ShoppingList } from './shopping-list';

@Injectable()
export class ShoppingListService {
  constructor(
    @Inject(ANALYSIS_STORE) private readonly cache: AnalysisStore,
    private readonly analysis: VideoAnalysisService,
  ) {}

  /** Builds the list from cached analyses only; never calls Gemini. */
  async fromCache(dto: ShoppingListRequestDto): Promise<ShoppingList> {
    const householdSize = dto.householdSize ?? 1;
    const missing: string[] = [];
    const inputs: Array<{ analysis: VideoAnalysis; servings?: number }> = [];
    for (const item of dto.items) {
      const cached = await this.findCached(item.videoId);
      if (cached) inputs.push({ analysis: cached, servings: item.servings });
      else missing.push(item.videoId);
    }

    const list = buildShoppingList(inputs, householdSize);
    for (const id of missing) {
      list.warnings.unshift(`No analysis cached for ${id}; request a meal plan with it first.`);
    }
    return list;
  }

  private async findCached(videoId: string): Promise<VideoAnalysis | null> {
    const exact = await this.cache.get(videoId, this.analysis.provider(), this.analysis.model());
    if (exact) return exact;
    return (await this.cache.list()).find((a) => a.videoId === videoId && a.status === 'ok') ?? null;
  }
}
