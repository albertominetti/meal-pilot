import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { FdcFood, parseFood, RawFood } from './fdc-food';

export const FDC_CLIENT = Symbol('FDC_CLIENT');

const BASE_URL = 'https://api.nal.usda.gov/fdc/v1';
/** Generic foods with full nutrient profiles; branded foods are excluded. */
export const FDC_DATA_TYPES = ['Foundation', 'SR Legacy'];
const SEARCH_PAGE_SIZE = 25;
const MAX_IDS_PER_REQUEST = 20;
const TIMEOUT_MS = 10_000;

export interface FdcClient {
  readonly enabled: boolean;
  /** Ranked hits; portions are empty here (search doesn't return them). */
  search(query: string): Promise<FdcFood[]>;
  /** Full details with portions, batched. */
  foods(fdcIds: number[]): Promise<FdcFood[]>;
}

/**
 * FDC allows 1,000 requests per hour per key. The mapping cache keeps real
 * use far below that: each ingredient name costs one search, once.
 */
@Injectable()
export class HttpFdcClient implements FdcClient {
  constructor(private readonly config: AppConfigService) {}

  get enabled(): boolean {
    return Boolean(this.config.fdcApiKey);
  }

  async search(query: string): Promise<FdcFood[]> {
    const params = new URLSearchParams({
      query,
      dataType: FDC_DATA_TYPES.join(','),
      pageSize: String(SEARCH_PAGE_SIZE),
    });
    const body = (await this.request(`/foods/search?${params}`)) as { foods?: RawFood[] };
    return (body.foods ?? []).map(parseFood);
  }

  async foods(fdcIds: number[]): Promise<FdcFood[]> {
    const out: FdcFood[] = [];
    for (let i = 0; i < fdcIds.length; i += MAX_IDS_PER_REQUEST) {
      const chunk = fdcIds.slice(i, i + MAX_IDS_PER_REQUEST);
      const body = (await this.request('/foods', {
        method: 'POST',
        body: JSON.stringify({ fdcIds: chunk, format: 'full' }),
      })) as RawFood[];
      out.push(...body.map(parseFood));
    }
    return out;
  }

  /** The key goes in a header, never the URL, so it can't leak into logs. */
  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    const res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: { 'X-Api-Key': this.config.fdcApiKey, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`FDC request failed (${res.status})`);
    return res.json();
  }
}
