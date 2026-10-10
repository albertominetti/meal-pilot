import * as path from 'path';
import { Client } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

export const MIGRATIONS_FOLDER = path.join(process.cwd(), 'drizzle');

/** Arbitrary constant shared by every instance, so only one migrates at a time. */
const MIGRATION_LOCK_KEY = 4_216_801;

/**
 * Applies pending SQL migrations from drizzle/ over the direct (unpooled)
 * URL. Session advisory locks don't survive PgBouncer transaction pooling,
 * which is why this must never use the pooled DATABASE_URL.
 */
export async function runMigrations(directUrl: string): Promise<void> {
  const client = new Client({ connectionString: directUrl, connectionTimeoutMillis: 10_000 });
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    try {
      await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    }
  } finally {
    await client.end();
  }
}
