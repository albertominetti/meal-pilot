/**
 * Runs video analysis over a hand-labelled set and reports allergen recall
 * (the gate) plus ingredient unit and quantity accuracy.
 *
 *   npm run eval:analysis                 # eval/videos.labeled.json
 *   npm run eval:analysis -- path/to.json # another set
 *
 * Live mode (GEMINI_API_KEY set) calls Gemini once per uncached video; it is
 * not part of CI. Exits 1 when a confirmed allergen is missed.
 */
import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { LabeledVideo, ratio, scoreIngredients } from '../src/eval/analysis-eval';
import { MealPlanService } from '../src/meal-plan/meal-plan.service';
import { VideoAnalysisService } from '../src/videos/video-analysis.service';

const DEFAULT_SET = path.join(process.cwd(), 'eval', 'videos.labeled.json');
const EXAMPLE_SET = path.join(process.cwd(), 'eval', 'videos.labeled.example.json');

function pct(value: number | null): string {
  return value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`;
}

async function main(): Promise<void> {
  let file = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_SET;
  if (!fs.existsSync(file)) {
    console.warn(`${file} not found; using ${EXAMPLE_SET} (offline fixtures, not real labels).`);
    file = EXAMPLE_SET;
  }
  const videos = JSON.parse(fs.readFileSync(file, 'utf8')) as LabeledVideo[];

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const analysis = app.get(VideoAnalysisService);
  const mealPlan = app.get(MealPlanService);

  let expectedAllergens = 0;
  let caughtBySafetyCheck = 0;
  let reportedByModel = 0;
  const misses: string[] = [];
  let matched = 0;
  let unitCorrect = 0;
  let quantityOk = 0;
  let expectedIngredients = 0;

  console.log(`Evaluating ${videos.length} videos with ${analysis.provider()}/${analysis.model()}\n`);
  for (const video of videos) {
    const result = await analysis.analyze({
      videoId: video.videoId,
      title: video.title,
      channel: video.channel,
    });
    if (result.status !== 'ok') {
      console.log(`  ${video.videoId}: unavailable (${result.error})`);
    }

    for (const allergen of video.expectedAllergens) {
      expectedAllergens++;
      if (result.detectedAllergens.includes(allergen)) reportedByModel++;
      // What protects the user is the deterministic verdict, so that is the gate.
      const verdict = mealPlan.evaluateAllergySafety(result, [allergen]);
      if (verdict.status !== 'safe') caughtBySafetyCheck++;
      else misses.push(`${video.videoId}: ${allergen}`);
    }

    if (video.expectedIngredients?.length) {
      const s = scoreIngredients(video.expectedIngredients, result.ingredients);
      matched += s.matched;
      unitCorrect += s.unitCorrect;
      quantityOk += s.quantityWithinTolerance;
      expectedIngredients += s.expected;
      console.log(
        `  ${video.videoId}: ${s.matched}/${s.expected} ingredients found, ${s.unitCorrect} correct unit, ${s.quantityWithinTolerance} quantity ±20%`,
      );
    }
  }
  await app.close();

  const recall = ratio(caughtBySafetyCheck, expectedAllergens);
  console.log('\nAllergens');
  console.log(`  recall (safety check, gate): ${pct(recall)} (${caughtBySafetyCheck}/${expectedAllergens})`);
  console.log(`  reported by model:           ${pct(ratio(reportedByModel, expectedAllergens))}`);
  console.log('Ingredients (of matched)');
  console.log(`  found:            ${pct(ratio(matched, expectedIngredients))} (${matched}/${expectedIngredients})`);
  console.log(`  correct unit:     ${pct(ratio(unitCorrect, matched))}`);
  console.log(`  quantity ±20%:    ${pct(ratio(quantityOk, matched))}`);

  if (misses.length) {
    console.error(`\nGATE FAILED: missed allergens:\n  ${misses.join('\n  ')}`);
    process.exit(1);
  }
  console.log('\nGate passed: no labelled allergen was missed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
