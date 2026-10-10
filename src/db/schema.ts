import {
  boolean,
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

/**
 * Phase 7: user data. Health profiles are GDPR Art. 9 special-category data:
 * stored only with explicit consent (consent_at) and deleted with
 * DELETE /api/users/:userId/profile, together with plans and meal logs.
 * user_id is the opaque id the JJFit app sends; this service has no login.
 */
export const profiles = pgTable('profiles', {
  userId: text('user_id').primaryKey(),
  data: jsonb('data').notNull(),
  consentAt: timestamp('consent_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

/** Every meal-plan response. Plans without a user are deleted after 30 days. */
export const plans = pgTable(
  'plans',
  {
    id: text('id').primaryKey(),
    userId: text('user_id'),
    version: integer('version').notNull(),
    /** The effective profile the plan was built for; swaps re-check safety against it. */
    request: jsonb('request').notNull(),
    items: jsonb('items').notNull(),
    shoppingList: jsonb('shopping_list').notNull(),
    checked: jsonb('checked').$type<string[]>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('plans_user_id_idx').on(t.userId), index('plans_created_at_idx').on(t.createdAt)],
);

export const mealLogs = pgTable(
  'meal_logs',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    videoId: text('video_id').notNull(),
    planId: text('plan_id'),
    cooked: boolean('cooked').notNull(),
    rating: integer('rating'),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('meal_logs_user_id_idx').on(t.userId)],
);
