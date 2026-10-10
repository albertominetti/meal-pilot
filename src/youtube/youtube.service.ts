import { Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../config/app-config.service';

export interface YouTubeVideoDetails {
  videoId: string;
  title: string;
  channel: string;
  durationSec: number;
  privacyStatus: string;
  embeddable: boolean;
  language?: string;
  description?: string;
}

export interface YouTubeSearchOptions {
  maxResults?: number;
  /** Drop videos longer than this many minutes. */
  maxMinutes?: number;
  language?: string;
}

export class YouTubeError extends Error {
  constructor(
    public readonly code: 'disabled' | 'quota_exceeded' | 'api_error',
    message: string,
  ) {
    super(message);
    this.name = 'YouTubeError';
  }
}

/** Abstract so tests/agent can inject a fake. */
export abstract class YouTubeClient {
  abstract isEnabled(): boolean;
  abstract search(query: string, opts?: YouTubeSearchOptions): Promise<YouTubeVideoDetails[]>;
  abstract getDetails(videoIds: string[]): Promise<Map<string, YouTubeVideoDetails>>;
  abstract quota(): { used: number; limit: number; day: string };
}

const API = 'https://www.googleapis.com/youtube/v3';
const SEARCH_COST = 100;
const VIDEOS_COST = 1;
const SEARCH_CACHE_MS = 24 * 3600_000;

/**
 * YouTube Data API v3 via plain fetch (no googleapis dependency).
 * search.list = 100 units, videos.list = 1 unit per call (≤50 ids).
 * Default project quota is 10,000 units/day; we stop at YOUTUBE_DAILY_QUOTA.
 */
@Injectable()
export class YouTubeService extends YouTubeClient {
  private readonly logger = new Logger(YouTubeService.name);
  private usage = { day: today(), used: 0 };
  private readonly searchCache = new Map<string, { at: number; ids: string[] }>();
  private readonly detailsCache = new Map<string, YouTubeVideoDetails>();

  constructor(private readonly config: AppConfig) {
    super();
  }

  isEnabled(): boolean {
    return Boolean(this.config.youtubeApiKey);
  }

  quota() {
    this.rollDay();
    return { used: this.usage.used, limit: this.config.youtubeDailyQuota, day: this.usage.day };
  }

  async search(query: string, opts: YouTubeSearchOptions = {}): Promise<YouTubeVideoDetails[]> {
    const key = this.requireKey();
    const q = query.trim().replace(/\s+/g, ' ').slice(0, 200);
    const max = Math.min(Math.max(opts.maxResults ?? 8, 1), 25);
    const cacheKey = `${q.toLowerCase()}|${max}|${opts.language ?? ''}`;
    let ids = this.searchCache.get(cacheKey);
    if (!ids || Date.now() - ids.at > SEARCH_CACHE_MS) {
      this.charge(SEARCH_COST);
      const params = new URLSearchParams({
        part: 'snippet',
        type: 'video',
        q,
        maxResults: String(max),
        videoEmbeddable: 'true',
        safeSearch: 'strict',
        videoDuration: 'medium', // 4-20 minutes
        key,
      });
      if (opts.language) params.set('relevanceLanguage', opts.language);
      if (this.config.youtubeRegion) params.set('regionCode', this.config.youtubeRegion);
      const body = await this.get(`${API}/search?${params}`);
      ids = {
        at: Date.now(),
        ids: (body.items ?? []).map((i: any) => i?.id?.videoId).filter((x: unknown): x is string => typeof x === 'string'),
      };
      this.searchCache.set(cacheKey, ids);
    }
    const details = await this.getDetails(ids.ids);
    const maxSec = (opts.maxMinutes ?? this.config.maxVideoMinutes) * 60;
    return ids.ids
      .map((id) => details.get(id))
      .filter((d): d is YouTubeVideoDetails => !!d)
      .filter((d) => d.privacyStatus === 'public' && d.durationSec > 0 && d.durationSec <= maxSec);
  }

  async getDetails(videoIds: string[]): Promise<Map<string, YouTubeVideoDetails>> {
    const out = new Map<string, YouTubeVideoDetails>();
    const missing: string[] = [];
    for (const id of new Set(videoIds)) {
      const c = this.detailsCache.get(id);
      if (c) out.set(id, c);
      else missing.push(id);
    }
    if (!missing.length) return out;
    const key = this.requireKey();
    for (let i = 0; i < missing.length; i += 50) {
      const batch = missing.slice(i, i + 50);
      this.charge(VIDEOS_COST);
      const params = new URLSearchParams({
        part: 'snippet,contentDetails,status',
        id: batch.join(','),
        maxResults: '50',
        key,
      });
      const body = await this.get(`${API}/videos?${params}`);
      for (const item of body.items ?? []) {
        const d: YouTubeVideoDetails = {
          videoId: item.id,
          title: item.snippet?.title ?? `YouTube video ${item.id}`,
          channel: item.snippet?.channelTitle ?? 'Unknown channel',
          durationSec: parseIsoDuration(item.contentDetails?.duration ?? ''),
          privacyStatus: item.status?.privacyStatus ?? 'unknown',
          embeddable: item.status?.embeddable !== false,
          language: item.snippet?.defaultAudioLanguage ?? item.snippet?.defaultLanguage,
          description: typeof item.snippet?.description === 'string' ? item.snippet.description.slice(0, 500) : undefined,
        };
        this.detailsCache.set(d.videoId, d);
        out.set(d.videoId, d);
      }
    }
    return out;
  }

  private requireKey(): string {
    const key = this.config.youtubeApiKey;
    if (!key) throw new YouTubeError('disabled', 'YouTube search disabled: set YOUTUBE_API_KEY');
    return key;
  }

  private rollDay() {
    const d = today();
    if (this.usage.day !== d) this.usage = { day: d, used: 0 };
  }

  private charge(units: number) {
    this.rollDay();
    const limit = this.config.youtubeDailyQuota;
    if (this.usage.used + units > limit) {
      throw new YouTubeError('quota_exceeded', `YouTube daily quota guard reached (${this.usage.used}/${limit} units)`);
    }
    this.usage.used += units;
  }

  private async get(url: string): Promise<any> {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const redacted = text.replace(/key=[^&\s"]+/g, 'key=***').slice(0, 300);
      if (res.status === 403 && /quota/i.test(text)) {
        throw new YouTubeError('quota_exceeded', `YouTube API quota exceeded: ${redacted}`);
      }
      this.logger.warn(`YouTube API ${res.status}: ${redacted}`);
      throw new YouTubeError('api_error', `YouTube API error ${res.status}`);
    }
    return res.json();
  }
}

/** PT1H2M3S -> 3723. Returns 0 for unparseable / live (P0D). */
export function parseIsoDuration(iso: string): number {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso);
  if (!m) return 0;
  const [, d, h, mi, s] = m.map((x) => (x ? parseInt(x, 10) : 0));
  return d * 86400 + h * 3600 + mi * 60 + s;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
