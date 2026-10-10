import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { and, eq, gt, lt, sql } from 'drizzle-orm';
import { DatabaseService } from '../db/database.service';
import { videoAnalyses } from '../db/schema';
import { ANALYSIS_SCHEMA_VERSION, VideoAnalysis } from './analyzers/analysis.schema';
import { ANALYSIS_TTL_MS, AnalysisStore, shouldPersist } from './analysis-store';

const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

function cutoff(): Date {
  return new Date(Date.now() - ANALYSIS_TTL_MS);
}

/**
 * Shared analysis cache in Postgres: survives deploys and is reused across
 * users. Expired rows are deleted at startup and once a day, inside the app.
 */
@Injectable()
export class PgAnalysisStore implements AnalysisStore, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PgAnalysisStore.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly database: DatabaseService) {}

  onModuleInit(): void {
    void this.cleanup();
    this.timer = setInterval(() => void this.cleanup(), CLEANUP_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  async cleanup(): Promise<number> {
    try {
      const deleted = await this.database.run('analyses.cleanup', (db) =>
        db.delete(videoAnalyses).where(lt(videoAnalyses.analyzedAt, cutoff())).returning({ id: videoAnalyses.videoId }),
      );
      if (deleted.length) this.logger.log(`Deleted ${deleted.length} expired analyses`);
      return deleted.length;
    } catch (err) {
      this.logger.warn(`Analysis cleanup failed: ${(err as Error).message}`);
      return 0;
    }
  }

  async get(videoId: string, provider: 'gemini' | 'mock', model: string): Promise<VideoAnalysis | null> {
    const rows = await this.database.run('analyses.get', (db) =>
      db
        .select({ data: videoAnalyses.data })
        .from(videoAnalyses)
        .where(
          and(
            eq(videoAnalyses.videoId, videoId),
            eq(videoAnalyses.provider, provider),
            eq(videoAnalyses.model, model),
            eq(videoAnalyses.schemaVersion, ANALYSIS_SCHEMA_VERSION),
            gt(videoAnalyses.analyzedAt, cutoff()),
          ),
        )
        .limit(1),
    );
    return (rows[0]?.data as VideoAnalysis | undefined) ?? null;
  }

  async set(entry: VideoAnalysis, currentSystemMode?: 'live' | 'mock'): Promise<VideoAnalysis> {
    if (!shouldPersist(entry, currentSystemMode)) return entry;
    const row = {
      videoId: entry.videoId,
      provider: entry.provider,
      model: entry.model,
      schemaVersion: entry.schemaVersion || ANALYSIS_SCHEMA_VERSION,
      data: entry,
      analyzedAt: new Date(entry.analyzedAt),
    };
    await this.database.run('analyses.set', (db) =>
      db
        .insert(videoAnalyses)
        .values(row)
        .onConflictDoUpdate({
          target: [videoAnalyses.videoId, videoAnalyses.provider, videoAnalyses.model, videoAnalyses.schemaVersion],
          set: { data: row.data, analyzedAt: row.analyzedAt },
        }),
    );
    return entry;
  }

  async list(): Promise<VideoAnalysis[]> {
    const rows = await this.database.run('analyses.list', (db) =>
      db
        .select({ data: videoAnalyses.data })
        .from(videoAnalyses)
        .where(and(eq(videoAnalyses.schemaVersion, ANALYSIS_SCHEMA_VERSION), gt(videoAnalyses.analyzedAt, cutoff())))
        .orderBy(sql`${videoAnalyses.analyzedAt} desc`),
    );
    return rows.map((r) => r.data as VideoAnalysis);
  }

  async clear(videoId?: string): Promise<{ cleared: number }> {
    const deleted = await this.database.run('analyses.clear', (db) =>
      db
        .delete(videoAnalyses)
        .where(videoId ? eq(videoAnalyses.videoId, videoId) : undefined)
        .returning({ id: videoAnalyses.videoId }),
    );
    return { cleared: deleted.length };
  }
}
