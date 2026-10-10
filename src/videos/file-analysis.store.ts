import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { ANALYSIS_SCHEMA_VERSION, VideoAnalysis } from './analyzers/analysis.schema';
import { AnalysisStore, isExpired, shouldPersist } from './analysis-store';

function sanitize(str: string): string {
  return str.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/** JSON files in MEALPILOT_CACHE_DIR (default data/cache), used without a database. */
@Injectable()
export class FileAnalysisStore implements AnalysisStore {
  private readonly logger = new Logger(FileAnalysisStore.name);
  private readonly memory = new Map<string, VideoAnalysis>();

  cacheDir(): string {
    const dir =
      process.env.MEALPILOT_CACHE_DIR || path.join(process.cwd(), 'data', 'cache');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  private keyFor(
    videoId: string,
    provider: string,
    model: string,
    version = ANALYSIS_SCHEMA_VERSION,
  ): string {
    return `${videoId}.${provider}.${sanitize(model)}.v${version}`;
  }

  private fileFor(
    videoId: string,
    provider: string,
    model: string,
    version = ANALYSIS_SCHEMA_VERSION,
  ): string {
    return path.join(
      this.cacheDir(),
      `${this.keyFor(videoId, provider, model, version)}.json`,
    );
  }

  async get(
    videoId: string,
    provider: 'gemini' | 'mock' = 'gemini',
    model = 'gemini-3.8-flash',
  ): Promise<VideoAnalysis | null> {
    const cacheKey = this.keyFor(videoId, provider, model);
    if (this.memory.has(cacheKey)) {
      const memEntry = this.memory.get(cacheKey)!;
      if (isExpired(memEntry.analyzedAt)) {
        this.memory.delete(cacheKey);
        return null;
      }
      return memEntry;
    }

    const filePath = this.fileFor(videoId, provider, model);
    if (fs.existsSync(filePath)) {
      try {
        const parsed = JSON.parse(
          fs.readFileSync(filePath, 'utf8'),
        ) as VideoAnalysis;

        if (parsed.schemaVersion !== ANALYSIS_SCHEMA_VERSION) {
          return null;
        }

        if (isExpired(parsed.analyzedAt)) {
          this.logger.debug(`Cache expired for ${cacheKey}`);
          try {
            fs.unlinkSync(filePath);
          } catch {
            // ignore
          }
          return null;
        }

        this.memory.set(cacheKey, parsed);
        return parsed;
      } catch (err) {
        this.logger.warn(`Ignoring corrupt cache file ${filePath}: ${err}`);
        return null;
      }
    }

    return null;
  }

  async set(entry: VideoAnalysis, currentSystemMode?: 'live' | 'mock'): Promise<VideoAnalysis> {
    if (!shouldPersist(entry, currentSystemMode)) {
      return entry;
    }

    const cacheKey = this.keyFor(
      entry.videoId,
      entry.provider,
      entry.model,
      entry.schemaVersion || ANALYSIS_SCHEMA_VERSION,
    );

    this.memory.set(cacheKey, entry);

    try {
      const filePath = this.fileFor(
        entry.videoId,
        entry.provider,
        entry.model,
        entry.schemaVersion || ANALYSIS_SCHEMA_VERSION,
      );
      fs.writeFileSync(filePath, JSON.stringify(entry, null, 2));
    } catch (err) {
      this.logger.warn(`Could not persist cache for ${entry.videoId}: ${err}`);
    }

    return entry;
  }

  async list(): Promise<VideoAnalysis[]> {
    return this.listSync();
  }

  private listSync(): VideoAnalysis[] {
    const dir = this.cacheDir();
    const versionPattern = new RegExp(`\\.v${ANALYSIS_SCHEMA_VERSION}\\.json$`);
    const files = fs.existsSync(dir)
      ? fs.readdirSync(dir).filter((f) => versionPattern.test(f))
      : [];

    const out: VideoAnalysis[] = [];
    for (const f of files) {
      try {
        const parsed = JSON.parse(
          fs.readFileSync(path.join(dir, f), 'utf8'),
        ) as VideoAnalysis;
        if (!isExpired(parsed.analyzedAt)) {
          out.push(parsed);
        }
      } catch {
        // skip corrupt files
      }
    }

    for (const [, entry] of this.memory) {
      if (
        !isExpired(entry.analyzedAt) &&
        !out.find((e) => e.videoId === entry.videoId && e.provider === entry.provider)
      ) {
        out.push(entry);
      }
    }

    return out;
  }

  async clear(videoId?: string): Promise<{ cleared: number }> {
    const dir = this.cacheDir();
    if (videoId) {
      let count = 0;
      for (const [key] of this.memory) {
        if (key.startsWith(`${videoId}.`)) {
          this.memory.delete(key);
        }
      }
      if (fs.existsSync(dir)) {
        for (const f of fs.readdirSync(dir)) {
          if (f.startsWith(`${videoId}.`)) {
            try {
              fs.unlinkSync(path.join(dir, f));
              count++;
            } catch {
              // ignore
            }
          }
        }
      }
      return { cleared: count || 1 };
    }

    const n = this.listSync().length;
    this.memory.clear();
    if (fs.existsSync(dir)) {
      // Only analysis files ("<videoId>.<provider>.<model>.v<n>.json"); other
      // stores share this directory.
      for (const f of fs.readdirSync(dir).filter((f) => /\.v\d+\.json$/.test(f))) {
        try {
          fs.unlinkSync(path.join(dir, f));
        } catch {
          // ignore
        }
      }
    }
    return { cleared: n };
  }
}

