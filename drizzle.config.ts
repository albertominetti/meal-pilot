import { defineConfig } from 'drizzle-kit';

// Migrations always use the direct (unpooled) URL: PgBouncer transaction
// pooling breaks the session features migrations rely on.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL_DIRECT ?? '' },
  strict: true,
});
