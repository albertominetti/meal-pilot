/**
 * Allergen-detection eval against hand-labelled real videos (live Gemini).
 * Gate for making live mode the production default: recall on labelled
 * allergens must be 100% (over-flagging is acceptable, missing is not).
 *
 *   npm run eval:analysis                          # uses eval/videos.labeled.json
 *   npm run eval:analysis -- eval/my-set.json
 *
 * File format: see eval/videos.labeled.example.json
 */
import 'reflect-metadata';
import * as fs from 'fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { CANONICAL_ALLERGENS } from '../src/videos/analysis.schema';
import { GeminiVideoAnalyzer } from '../src/videos/analyzers/gemini-video-analyzer';

interface Labeled {
  videoId: string;
  title: string;
  /** EU-14 canonical allergens that ARE in the recipe. */
  allergens: string[];
  notes?: string;
}

async function main() {
  const file = process.argv[2] ?? 'eval/videos.labeled.json';
  if (!fs.existsSync(file)) throw new Error(`${file} not found — copy eval/videos.labeled.example.json and label real videos`);
  const set: Labeled[] = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const v of set) {
    const bad = v.allergens.filter((a) => !(CANONICAL_ALLERGENS as readonly string[]).includes(a));
    if (bad.length) throw new Error(`${v.videoId}: unknown allergens ${bad.join(', ')}`);
  }
  process.env.MEALPILOT_LLM_MODE ??= 'live';
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  const analyzer = app.get(GeminiVideoAnalyzer); // bypasses the cache on purpose

  let tp = 0;
  let fn = 0;
  let fp = 0;
  let unavailable = 0;
  for (const v of set) {
    const a = await analyzer.analyze({ videoId: v.videoId, title: v.title, channel: '' });
    if (a.status !== 'ok') {
      unavailable++;
      console.log(`✗ ${v.videoId} ${v.title}: UNAVAILABLE (${a.error})`);
      continue;
    }
    const found = new Set(a.allergens.map((f) => f.allergen as string));
    const expected = new Set(v.allergens);
    const missed = [...expected].filter((x) => !found.has(x));
    const extra = [...found].filter((x) => !expected.has(x));
    tp += expected.size - missed.length;
    fn += missed.length;
    fp += extra.length;
    console.log(
      `${missed.length ? '✗' : '✓'} ${v.videoId} ${v.title}` +
        (missed.length ? `  MISSED: ${missed.join(', ')}` : '') +
        (extra.length ? `  extra: ${extra.join(', ')}` : ''),
    );
  }
  const recall = tp + fn ? tp / (tp + fn) : 1;
  const precision = tp + fp ? tp / (tp + fp) : 1;
  console.log(`\nvideos=${set.length} unavailable=${unavailable} recall=${(recall * 100).toFixed(1)}% precision=${(precision * 100).toFixed(1)}%`);
  await app.close();
  if (fn > 0 || unavailable > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
