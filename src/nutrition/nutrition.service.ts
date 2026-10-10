import { Inject, Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { normalizeIngredientName } from '../recipes/normalize';
import { Ingredient, VideoAnalysis } from '../videos/analyzers/analysis.schema';
import { FdcFood } from './fdc-food';
import { FDC_MAPPING_STORE, FdcMappingStore, isUsable } from './fdc-mapping.store';
import { FDC_CLIENT, FdcClient } from './fdc.client';
import { pickFood } from './food-match';
import { computeNutrition, mappingKey, matchHints, NUTRITION_VERSION } from './nutrition';

export const FDC_OVERRIDES_FILE = path.join(process.cwd(), 'data', 'fdc-overrides.json');

/** Team-reviewed fixes for common mismatches, keyed like mappingKey(). */
export type FdcOverrides = Record<string, { fdcId: number; note?: string }>;

export function loadOverrides(file = FDC_OVERRIDES_FILE): FdcOverrides {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { overrides?: FdcOverrides };
    return parsed.overrides ?? {};
  } catch {
    return {};
  }
}

/** Ingredients worth a lookup: the rest stay unresolved whatever the food. */
function lookupWorthy(i: Ingredient): boolean {
  return i.confidence !== 'low' && i.quantity !== null && i.unit !== null && i.unit !== 'pinch';
}

/**
 * Adds USDA-based nutrients to an analysis. Gemini only extracts the
 * ingredients; matching, grams and sums happen here, in code. When FDC is
 * down the analysis still comes back, with `nutrition: null`.
 */
@Injectable()
export class NutritionService {
  private readonly logger = new Logger(NutritionService.name);
  private readonly inflight = new Map<string, Promise<FdcFood | null>>();
  private readonly overrides: FdcOverrides;

  constructor(
    @Inject(FDC_CLIENT) private readonly client: FdcClient,
    @Inject(FDC_MAPPING_STORE) private readonly mappings: FdcMappingStore,
    overrides?: FdcOverrides,
  ) {
    this.overrides = overrides ?? loadOverrides();
  }

  get enabled(): boolean {
    return this.client.enabled;
  }

  /** True when the analysis lacks current nutrients and could get them. */
  needsUpdate(analysis: VideoAnalysis): boolean {
    return this.enabled && analysis.status === 'ok' && analysis.nutrition?.version !== NUTRITION_VERSION;
  }

  async ensure(analysis: VideoAnalysis): Promise<VideoAnalysis> {
    if (!this.needsUpdate(analysis)) return analysis;
    try {
      const foods = new Map<string, FdcFood | null>();
      const wanted = new Map<string, Ingredient>();
      for (const i of analysis.ingredients ?? []) {
        if (lookupWorthy(i)) wanted.set(mappingKey(i), i);
      }
      await Promise.all(
        [...wanted].map(async ([key, i]) => foods.set(key, await this.foodFor(key, i))),
      );
      return { ...analysis, nutrition: computeNutrition(analysis, foods) };
    } catch (err) {
      this.logger.warn(`Nutrients unavailable for ${analysis.videoId}: ${(err as Error).message}`);
      return { ...analysis, nutrition: null };
    }
  }

  /** Concurrent analyses share one lookup per ingredient. */
  private foodFor(key: string, i: Ingredient): Promise<FdcFood | null> {
    let pending = this.inflight.get(key);
    if (!pending) {
      pending = this.lookup(key, i).finally(() => this.inflight.delete(key));
      this.inflight.set(key, pending);
    }
    return pending;
  }

  private async lookup(key: string, i: Ingredient): Promise<FdcFood | null> {
    const cached = await this.mappings.get(key);
    if (isUsable(cached)) return cached.food;

    const name = normalizeIngredientName(i.name);
    const hints = matchHints(i);
    const override = this.overrides[key] ?? this.overrides[name];

    let fdcId: number | null = override?.fdcId ?? null;
    if (fdcId === null) {
      const hits = await this.client.search(hints.canned ? `${name} canned` : name);
      fdcId = pickFood(name, hints, hits)?.fdcId ?? null;
    }
    // Details carry the portions ("1 clove") that search results lack.
    const food = fdcId === null ? null : ((await this.client.foods([fdcId]))[0] ?? null);
    await this.mappings.set({ key, food, updatedAt: new Date().toISOString() });
    return food;
  }
}
