export interface YouTubeVideoDetails {
  videoId: string;
  title: string;
  channel: string;
  durationSec: number;
  privacyStatus: string;
  embeddable: boolean;
  language?: string;
}

export interface YouTubeSearchOptions {
  maxResults?: number;
  relevanceLanguage?: string;
}

export interface IYouTubeService {
  search(query: string, opts?: YouTubeSearchOptions): Promise<string[]>;
  getDetails(ids: string[]): Promise<YouTubeVideoDetails[]>;
  getQuotaUsage(): { unitsUsedToday: number; dailyCap: number };
}

export const YOUTUBE_SERVICE = Symbol('YOUTUBE_SERVICE');

export function parseIsoDuration(duration: string): number {
  if (!duration) return 0;
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const hours = parseInt(match[1] || '0', 10);
  const minutes = parseInt(match[2] || '0', 10);
  const seconds = parseInt(match[3] || '0', 10);
  return hours * 3600 + minutes * 60 + seconds;
}
