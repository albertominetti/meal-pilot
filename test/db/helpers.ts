import { Client } from 'pg';
import { DatabaseService } from '../../src/db/database.service';
import { runMigrations } from '../../src/db/migrate';

/**
 * The db suite runs against a real Postgres: a temporary Neon branch in CI,
 * or `docker compose up postgres` locally. It never touches a shared database.
 */
export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL must be set for the db suite');
  return url;
}

export async function resetDatabase(): Promise<void> {
  const url = testDatabaseUrl();
  await runMigrations(url);
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
    );
    if (rows.length) {
      await client.query(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(', ')} CASCADE`);
    }
  } finally {
    await client.end();
  }
}

export function testDatabaseService(): DatabaseService {
  return new DatabaseService({ databaseUrl: testDatabaseUrl(), databaseUrlDirect: '' } as any);
}
