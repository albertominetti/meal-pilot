import { Injectable, Logger, Optional } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { AppConfig } from '../config/app-config.service';
import {
  ANALYSIS_SCHEMA_VERSION,
  AnalysisProvider,
  VideoAnalysis,
  VideoRef,
} from './analysis.schema';

const SEED_FILE = path.join(process.cwd(), 'data', 'videos.seed.json');

/**
 * Persistent file cache for per-video analyses (cache v2).
 *
 * Files: <cacheDir>/<videoId>__<provider>__<model>__v<schema>.json
 * - keyed by provider + model + schema version, so mock results are never
 *   served in live mode and prompt/schema changes invalidate old entries;
 * - legacy un-versioned files (<videoId>.json) are ignored;
 * - entries older than CACHE_TTL_DAYS (0 = never expire) are treated as misses;
 * - `unavailable` analyses are never persisted (caller's responsibility, enforced here too).
 */
@Injectable()
export class TranscriptCacheService {
  private readonly logger = new Logger(TranscriptCacheService.name);
  private readonly memory = new Map<string, VideoAnalysis>();
  private readonly config: AppConfig;

  constructor(@Optional() config?: AppConfig) {
    this.config = config ?? new AppConfig();
  }

  cacheDir(): string {
    const dir = process.env.MEALPILOT_CACHE_DIR || path.join(process.cwd(), 'data', 'cache');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  static key(videoId: string, provider: AnalysisProvider, model: string): string {
    const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, '_');
    return `${safe(videoId)}__${provider}__${safe(model)}__v${ANALYSIS_SCHEMA_VERSION}`;
  }

  private fileFor(key: string): string {
    return path.join(this.cacheDir(), `${key}.json`);
  }

  private fresh(entry: VideoAnalysis): boolean {
    if (entry.schemaVersion !== ANALYSIS_SCHEMA_VERSION || entry.status !== 'ok') return false;
    const ttlDays = this.config.cacheTtlDays;
    if (!ttlDays) return true;
    const age = Date.now() - Date.parse(entry.analyzedAt);
    return Number.isFinite(age) && age <= ttlDays * 86_400_000;
  }

  get(videoId: string, provider: AnalysisProvider, model: string): VideoAnalysis | null {
    const key = TranscriptCacheService.key(videoId, provider, model);
    const mem = this.memory.get(key);
    if (mem) return this.fresh(mem) ? mem : null;
    const file = this.fileFor(key);
    if (!fs.existsSync(file)) return null;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as VideoAnalysis;
      if (!this.fresh(parsed)) return null;
      this.memory.set(key, parsed);
      return parsed;
    } catch (err) {
      this.logger.warn(`Ignoring corrupt cache file ${file}: ${err}`);
      return null;
    }
  }

  set(entry: VideoAnalysis): VideoAnalysis {
    if (entry.status !== 'ok') return entry;
    const key = TranscriptCacheService.key(entry.videoId, entry.provider, entry.model);
    this.memory.set(key, entry);
    try {
      fs.writeFileSync(this.fileFor(key), JSON.stringify(entry, null, 2));
    } catch (err) {
      this.logger.warn(`Could not persist cache for ${entry.videoId}: ${err}`);
    }
    return entry;
  }

  /** All fresh v2 entries, optionally filtered to one provider/model. */
  list(filter?: { provider?: AnalysisProvider; model?: string }): VideoAnalysis[] {
    const byKey = new Map<string, VideoAnalysis>();
    const dir = this.cacheDir();
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f.includes('__'))) {
      try {
        const e = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as VideoAnalysis;
        byKey.set(f.slice(0, -5), e);
      } catch {
        // skip corrupt files
      }
    }
    for (const [k, e] of this.memory) if (!byKey.has(k)) byKey.set(k, e);
    return [...byKey.values()].filter(
      (e) =>
        this.fresh(e) &&
        (!filter?.provider || e.provider === filter.provider) &&
        (!filter?.model || e.model === filter.model),
    );
  }

  clear(videoId?: string): { cleared: number } {
    const dir = this.cacheDir();
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    const match = (name: string) =>
      !videoId || name === `${videoId}.json` || name.startsWith(`${videoId}__`);
    let cleared = 0;
    for (const f of files.filter(match)) {
      fs.unlinkSync(path.join(dir, f));
      cleared++;
    }
    for (const k of [...this.memory.keys()]) {
      if (!videoId || k.startsWith(`${videoId}__`)) {
        if (!files.includes(`${k}.json`)) cleared++; // memory-only entry
        this.memory.delete(k);
      }
    }
    return { cleared };
  }

  loadSeed(): VideoRef[] {
    try {
      if (!fs.existsSync(SEED_FILE)) return [];
      const parsed = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
      const list = Array.isArray(parsed) ? parsed : parsed.videos ?? [];
      return list.filter((v: any) => v && typeof v.videoId === 'string');
    } catch {
      return [];
    }
  }
}
