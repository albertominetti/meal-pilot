/**
 * Live smoke test against the real Gemini (and YouTube, if configured) APIs.
 * Not part of CI. Needs GEMINI_API_KEY (read from .env or the environment).
 *
 *   npm run smoke:live                       # full agent run with a sample profile
 *   npm run smoke:live -- --video <id|url>   # analyze one video only
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AgentService } from '../src/agent/agent.service';
import { AppModule } from '../src/app.module';
import { AppConfig } from '../src/config/app-config.service';
import { VideoAnalysisService } from '../src/videos/video-analysis.service';
import { extractVideoId } from '../src/videos/youtube.util';

async function main() {
  process.env.MEALPILOT_LLM_MODE ??= 'live';
  process.env.MEALPILOT_CACHE_DIR ??= 'data/cache-smoke';
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['log', 'warn', 'error'] });
  const config = app.get(AppConfig);
  console.log('Config:', config.describe());
  if (config.llmMode !== 'live') throw new Error('Set GEMINI_API_KEY (and MEALPILOT_LLM_MODE=live|auto)');

  const videoArg = process.argv.indexOf('--video');
  if (videoArg > -1) {
    const id = extractVideoId(process.argv[videoArg + 1] ?? '');
    if (!id) throw new Error('Usage: --video <youtube id or url>');
    const started = Date.now();
    const { analysis } = await app.get(VideoAnalysisService).analyze({ videoId: id, title: `YouTube video ${id}`, channel: 'unknown' });
    console.log(JSON.stringify(analysis, null, 2));
    console.log(`\n${analysis.status} in ${Date.now() - started} ms`);
  } else {
    const res = await app.get(AgentService).run({
      healthProfile: 'hypertension, trying to lose weight',
      bloodPressure: '145/92',
      restrictions: ['vegetarian'],
      allergies: ['peanuts', 'sesame'],
      preferences: 'quick weeknight dinners',
      maxResults: 3,
      debug: true,
    } as any);
    console.log('\nTRACE');
    for (const t of res.trace ?? []) console.log(`  [${t.step}] ${t.tool} ${JSON.stringify(t.args)} -> ${t.ok ? 'ok' : 'ERR'} ${t.summary} (${t.durationMs} ms)`);
    console.log('\nRECOMMENDATIONS');
    for (const r of res.recommendations) console.log(`  - ${r.title} (${r.url})\n    ${r.whyItFits}\n    allergy: ${r.allergySafety.status}`);
    console.log('\nEXCLUDED');
    for (const e of res.excluded) console.log(`  - ${e.title}: ${e.reason}`);
    console.log('\nMETA', JSON.stringify({ ...res.meta, agent: res.agent }, null, 2));
  }
  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
