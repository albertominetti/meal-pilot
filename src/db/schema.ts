import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

/**
 * Shared across users and deploys ("popular recipes are reused"). The
 * primary key's leading column also serves lookups by video_id.
 */
export const videoAnalyses = pgTable(
  'video_analyses',
  {
    videoId: text('video_id').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    schemaVersion: integer('schema_version').notNull(),
    data: jsonb('data').notNull(),
    analyzedAt: timestamp('analyzed_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.videoId, t.provider, t.model, t.schemaVersion] }),
    index('video_analyses_analyzed_at_idx').on(t.analyzedAt),
  ],
);

/** Ingredient name to FDC food, reused across all videos. fdc_id null = no match. */
export const fdcMappings = pgTable('fdc_mappings', {
  normalisedName: text('normalised_name').primaryKey(),
  fdcId: integer('fdc_id'),
  description: text('description'),
  dataType: text('data_type'),
  nutrients: jsonb('nutrients'),
  portions: jsonb('portions'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const youtubeSearchCache = pgTable('youtube_search_cache', {
  queryNorm: text('query_norm').primaryKey(),
  videoIds: jsonb('video_ids').$type<string[]>().notNull(),
  cachedAt: timestamp('cached_at', { withTimezone: true }).notNull(),
});
