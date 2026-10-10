import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../db/database.service';
import { youtubeSearchCache } from '../db/schema';

export const SEARCH_CACHE = Symbol('SEARCH_CACHE');

/** Search results are cached for a day: each search.list call costs 100 quota units. */
export const SEARCH_TTL_MS = 24 * 60 * 60 * 1000;

export interface SearchCacheStore {
  get(queryNorm: string): Promise<string[] | null>;
  set(queryNorm: string, videoIds: string[]): Promise<void>;
}

export class MemorySearchCache implements SearchCacheStore {
  private readonly entries = new Map<string, { ids: string[]; expiresAt: number }>();

  async get(queryNorm: string): Promise<string[] | null> {
    const entry = this.entries.get(queryNorm);
    return entry && entry.expiresAt > Date.now() ? entry.ids : null;
  }

  async set(queryNorm: string, videoIds: string[]): Promise<void> {
    this.entries.set(queryNorm, { ids: videoIds, expiresAt: Date.now() + SEARCH_TTL_MS });
  }
}

/** Shared across instances and deploys, so a repeated query never spends quota twice. */
@Injectable()
export class PgSearchCache implements SearchCacheStore {
  constructor(private readonly database: DatabaseService) {}

  async get(queryNorm: string): Promise<string[] | null> {
    const rows = await this.database.run('search.get', (db) =>
      db.select().from(youtubeSearchCache).where(eq(youtubeSearchCache.queryNorm, queryNorm)).limit(1),
    );
    const row = rows[0];
    if (!row || Date.now() - row.cachedAt.getTime() > SEARCH_TTL_MS) return null;
    return row.videoIds;
  }

  async set(queryNorm: string, videoIds: string[]): Promise<void> {
    const cachedAt = new Date();
    await this.database.run('search.set', (db) =>
      db
        .insert(youtubeSearchCache)
        .values({ queryNorm, videoIds, cachedAt })
        .onConflictDoUpdate({ target: youtubeSearchCache.queryNorm, set: { videoIds, cachedAt } }),
    );
  }
}
