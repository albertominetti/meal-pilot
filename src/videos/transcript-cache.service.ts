import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

export interface CachedAnalysis {
  videoId: string;
  title: string;
  channel: string;
  transcript: string;
  ingredients: string[];
  nutritionSignals: string[];
  detectedAllergens: string[];
  restrictionTags: string[];
  summary: string;
  provider: 'gemini' | 'mock';
  analyzedAt: string;
}

const SEED_FILE = path.join(process.cwd(), 'data', 'videos.seed.json');

/**
 * Persistent file cache for per-video analyses.
 * Runtime entries live under data/cache/<videoId>.json (gitignored);
 * a committed demo seed (data/videos.seed.json) is used as fallback.
 */
@Injectable()
export class TranscriptCacheService {
  private readonly logger = new Logger(TranscriptCacheService.name);
  private readonly memory = new Map<string, CachedAnalysis>();

  cacheDir(): string {
    const dir =
      process.env.MEALPILOT_CACHE_DIR || path.join(process.cwd(), 'data', 'cache');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  private fileFor(videoId: string): string {
    return path.join(this.cacheDir(), `${videoId}.json`);
  }

  get(videoId: string): CachedAnalysis | null {
    if (this.memory.has(videoId)) return this.memory.get(videoId)!;
    const file = this.fileFor(videoId);
    if (fs.existsSync(file)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as CachedAnalysis;
        this.memory.set(videoId, parsed);
        return parsed;
      } catch (err) {
        this.logger.warn(`Ignoring corrupt cache file ${file}: ${err}`);
        return null;
      }
    }
    return null;
  }

  set(entry: CachedAnalysis): CachedAnalysis {
    this.memory.set(entry.videoId, entry);
    try {
      fs.writeFileSync(this.fileFor(entry.videoId), JSON.stringify(entry, null, 2));
    } catch (err) {
      this.logger.warn(`Could not persist cache for ${entry.videoId}: ${err}`);
    }
    return entry;
  }

  list(): CachedAnalysis[] {
    const dir = this.cacheDir();
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
    const out: CachedAnalysis[] = [];
    for (const f of files) {
      try {
        out.push(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
      } catch {
        // skip corrupt files
      }
    }
    for (const [id, entry] of this.memory) {
      if (!out.find((e) => e.videoId === id)) out.push(entry);
    }
    return out;
  }

  clear(videoId?: string): { cleared: number } {
    if (videoId) {
      this.memory.delete(videoId);
      const file = this.fileFor(videoId);
      if (fs.existsSync(file)) fs.unlinkSync(file);
      return { cleared: 1 };
    }
    const n = this.list().length;
    this.memory.clear();
    const dir = this.cacheDir();
    if (fs.existsSync(dir)) {
      for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
        fs.unlinkSync(path.join(dir, f));
      }
    }
    return { cleared: n };
  }

  loadSeed(): Array<{ videoId: string; title: string; channel: string }> {
    try {
      if (!fs.existsSync(SEED_FILE)) return [];
      const parsed = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
      return Array.isArray(parsed) ? parsed : parsed.videos ?? [];
    } catch {
      return [];
    }
  }
}
