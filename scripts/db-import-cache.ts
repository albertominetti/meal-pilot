/**
 * One-off: loads the file cache (current schema version only) into the
 * video_analyses table, so analyses made before Postgres aren't paid for twice.
 *
 *   DATABASE_URL=... npm run db:import-cache              # data/cache
 *   DATABASE_URL=... npm run db:import-cache -- some/dir  # another directory
 *
 * Run `npm run db:migrate` first. Existing rows are overwritten.
 */
import 'reflect-metadata';
import { DatabaseService } from '../src/db/database.service';
import { FileAnalysisStore } from '../src/videos/file-analysis.store';
import { PgAnalysisStore } from '../src/videos/pg-analysis.store';

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL must be set');
  if (process.argv[2]) process.env.MEALPILOT_CACHE_DIR = process.argv[2];

  const database = new DatabaseService({ databaseUrl, databaseUrlDirect: '' } as never);
  try {
    const entries = await new FileAnalysisStore().list();
    const target = new PgAnalysisStore(database);
    for (const entry of entries) await target.set(entry);
    console.log(`Imported ${entries.length} analyses`);
  } finally {
    await database.onModuleDestroy();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
