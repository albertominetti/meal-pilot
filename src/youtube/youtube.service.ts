import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { MemorySearchCache, SEARCH_CACHE, SearchCacheStore } from './search-cache.store';
import {
  IYouTubeService,
  parseIsoDuration,
  YouTubeSearchOptions,
  YouTubeVideoDetails,
} from './youtube.interface';

@Injectable()
export class YouTubeService implements IYouTubeService {
  private readonly logger = new Logger(YouTubeService.name);

  private unitsUsedToday = 0;
  private currentDay = new Date().toISOString().slice(0, 10);
  private readonly dailyCap = 9000; // Leave margin below the 10,000 unit default

  constructor(
    private readonly config: AppConfigService,
    @Optional()
    @Inject(SEARCH_CACHE)
    private readonly searchCache: SearchCacheStore = new MemorySearchCache(),
  ) {}

  private checkAndResetQuota(): void {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.currentDay) {
      this.currentDay = today;
      this.unitsUsedToday = 0;
    }
  }

  getQuotaUsage(): { unitsUsedToday: number; dailyCap: number } {
    this.checkAndResetQuota();
    return {
      unitsUsedToday: this.unitsUsedToday,
      dailyCap: this.dailyCap,
    };
  }

  async search(query: string, opts?: YouTubeSearchOptions): Promise<string[]> {
    const apiKey = this.config.youtubeApiKey;
    if (!apiKey) {
      this.logger.warn('YOUTUBE_API_KEY is not configured; search returning empty');
      return [];
    }

    const normQuery = query.trim().toLowerCase();
    const cached = await this.cachedSearch(normQuery);
    if (cached) {
      return cached;
    }

    this.checkAndResetQuota();
    if (this.unitsUsedToday + 100 > this.dailyCap) {
      throw new Error(
        `YouTube API daily quota threshold reached (${this.unitsUsedToday}/${this.dailyCap} units). Search refused.`,
      );
    }

    const maxResults = Math.min(opts?.maxResults ?? 10, 10);
    const params = new URLSearchParams({
      part: 'snippet',
      type: 'video',
      videoEmbeddable: 'true',
      safeSearch: 'strict',
      videoDuration: 'medium', // 4-20 minutes
      maxResults: String(maxResults),
      q: query,
      key: apiKey,
    });

    if (opts?.relevanceLanguage) {
      params.set('relevanceLanguage', opts.relevanceLanguage);
    }

    const url = `https://www.googleapis.com/youtube/v3/search?${params.toString()}`;
    const res = await fetch(url);
    this.unitsUsedToday += 100;

    if (!res.ok) {
      const errBody = await res.text();
      this.logger.error(`YouTube search.list failed (${res.status}): ${errBody}`);
      throw new Error(`YouTube search API error: ${res.status}`);
    }

    const data = (await res.json()) as any;
    const ids: string[] = (data.items || [])
      .map((item: any) => item.id?.videoId)
      .filter(Boolean);

    try {
      await this.searchCache.set(normQuery, ids);
    } catch (err) {
      this.logger.warn(`Could not cache search results: ${(err as Error).message}`);
    }

    return ids;
  }

  /** A cache outage must not block searching; it only costs quota. */
  private async cachedSearch(normQuery: string): Promise<string[] | null> {
    try {
      return await this.searchCache.get(normQuery);
    } catch (err) {
      this.logger.warn(`Search cache unavailable: ${(err as Error).message}`);
      return null;
    }
  }

  async getDetails(ids: string[]): Promise<YouTubeVideoDetails[]> {
    const apiKey = this.config.youtubeApiKey;
    if (!apiKey || ids.length === 0) {
      return [];
    }

    this.checkAndResetQuota();
    const results: YouTubeVideoDetails[] = [];
    const chunkSize = 50;

    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      if (this.unitsUsedToday + 1 > this.dailyCap) {
        this.logger.warn('YouTube quota reached during getDetails batch');
        break;
      }

      const params = new URLSearchParams({
        part: 'snippet,contentDetails,status',
        id: chunk.join(','),
        key: apiKey,
      });

      const url = `https://www.googleapis.com/youtube/v3/videos?${params.toString()}`;
      const res = await fetch(url);
      this.unitsUsedToday += 1;

      if (!res.ok) {
        const errBody = await res.text();
        this.logger.error(`YouTube videos.list failed (${res.status}): ${errBody}`);
        continue;
      }

      const data = (await res.json()) as any;
      for (const item of data.items || []) {
        const durationSec = parseIsoDuration(item.contentDetails?.duration || '');
        const privacyStatus = item.status?.privacyStatus || 'unknown';
        const embeddable = item.status?.embeddable !== false;

        // Filter out non-public or excessively long videos (> 25 minutes = 1500s)
        if (privacyStatus !== 'public' || !embeddable || durationSec > 1500) {
          continue;
        }

        results.push({
          videoId: item.id,
          title: item.snippet?.title || `YouTube video ${item.id}`,
          channel: item.snippet?.channelTitle || 'Unknown channel',
          channelId: item.snippet?.channelId || '',
          description: item.snippet?.description || '',
          durationSec,
          privacyStatus,
          embeddable,
          language: item.snippet?.defaultLanguage || item.snippet?.defaultAudioLanguage,
        });
      }
    }

    return results;
  }
}
