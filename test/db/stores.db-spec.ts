import { Client } from 'pg';
import { DatabaseService } from '../../src/db/database.service';
import { runMigrations } from '../../src/db/migrate';
import { PgAnalysisStore } from '../../src/videos/pg-analysis.store';
import { PgSearchCache } from '../../src/youtube/search-cache.store';
import { analysis } from '../fixtures/analysis';
import { resetDatabase, testDatabaseService, testDatabaseUrl } from './helpers';

describe('Postgres stores', () => {
  let database: DatabaseService;

  beforeAll(async () => {
    await resetDatabase();
    database = testDatabaseService();
  });

  beforeEach(resetDatabase);

  afterAll(async () => {
    await database.onModuleDestroy();
  });

  it('migrations are idempotent and safe to run concurrently', async () => {
    await expect(
      Promise.all([runMigrations(testDatabaseUrl()), runMigrations(testDatabaseUrl())]),
    ).resolves.toBeDefined();
  });

  it('reports the database as up', async () => {
    expect(await database.ping()).toBe('up');
  });

  describe('PgAnalysisStore', () => {
    it('stores, reads, lists and clears analyses', async () => {
      const store = new PgAnalysisStore(database);
      const a = analysis({ videoId: 'v1', provider: 'gemini', model: 'gemini-3.8-flash' });
      await store.set(a);
      await store.set({ ...a, recipeName: 'Updated' });

      expect((await store.get('v1', 'gemini', 'gemini-3.8-flash'))?.recipeName).toBe('Updated');
      expect(await store.get('v1', 'mock', 'mock')).toBeNull();
      expect((await store.list()).map((x) => x.videoId)).toEqual(['v1']);

      expect(await store.clear('v1')).toEqual({ cleared: 1 });
      expect(await store.list()).toEqual([]);
    });

    it('never stores unavailable results or mock results in live mode', async () => {
      const store = new PgAnalysisStore(database);
      await store.set(analysis({ videoId: 'bad', status: 'unavailable' }));
      await store.set(analysis({ videoId: 'mocked', provider: 'mock' }), 'live');
      expect(await store.list()).toEqual([]);
    });

    it('ignores expired rows and deletes them in cleanup', async () => {
      const store = new PgAnalysisStore(database);
      const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
      await store.set(analysis({ videoId: 'old', provider: 'gemini', model: 'm', analyzedAt: old }));
      await store.set(analysis({ videoId: 'fresh', provider: 'gemini', model: 'm' }));

      expect(await store.get('old', 'gemini', 'm')).toBeNull();
      expect((await store.list()).map((x) => x.videoId)).toEqual(['fresh']);
      expect(await store.cleanup()).toBe(1);
    });

    it('survives a restart: a new pool sees earlier analyses', async () => {
      await new PgAnalysisStore(database).set(analysis({ videoId: 'kept', provider: 'gemini', model: 'm' }));
      const restarted = testDatabaseService();
      try {
        expect((await new PgAnalysisStore(restarted).list()).map((x) => x.videoId)).toEqual(['kept']);
      } finally {
        await restarted.onModuleDestroy();
      }
    });
  });

  describe('PgSearchCache', () => {
    it('caches search results for a day', async () => {
      const cache = new PgSearchCache(database);
      expect(await cache.get('lentil soup')).toBeNull();
      await cache.set('lentil soup', ['a', 'b']);
      await cache.set('lentil soup', ['c']);
      expect(await cache.get('lentil soup')).toEqual(['c']);

      const client = new Client({ connectionString: testDatabaseUrl() });
      await client.connect();
      await client.query("UPDATE youtube_search_cache SET cached_at = now() - interval '25 hours'");
      await client.end();
      expect(await cache.get('lentil soup')).toBeNull();
    });
  });
});
