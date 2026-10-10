import * as fs from 'fs';
import * as path from 'path';

const SEED_FILE = path.join(process.cwd(), 'data', 'videos.seed.json');

export interface SeedVideo {
  videoId: string;
  title: string;
  channel: string;
}

/** Curated candidates for the deterministic /api/meal-plan pipeline. */
export function loadSeedVideos(file = SEED_FILE): SeedVideo[] {
  try {
    if (!fs.existsSync(file)) return [];
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? parsed : parsed.videos ?? [];
  } catch {
    return [];
  }
}
