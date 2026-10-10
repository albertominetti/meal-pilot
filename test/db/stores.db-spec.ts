import { Client } from 'pg';
import { DatabaseService } from '../../src/db/database.service';
import { runMigrations } from '../../src/db/migrate';
import { PgFdcMappingStore } from '../../src/nutrition/fdc-mapping.store';
import { PgUserDataStore, StoredPlan } from '../../src/users/user-data.store';
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

  describe('PgFdcMappingStore', () => {
    it('stores matches and no-matches', async () => {
      const store = new PgFdcMappingStore(database);
      const food = {
        fdcId: 170000,
        description: 'Onions, raw',
        dataType: 'SR Legacy',
        nutrients: { kcal: 40, protein: 1.1 },
        portions: [{ label: '1 medium', amount: 1, gramWeight: 110 }],
      };
      const updatedAt = new Date().toISOString();
      await store.set({ key: 'onion', food, updatedAt });
      await store.set({ key: 'unobtainium', food: null, updatedAt });

      expect(await store.get('onion')).toEqual({ key: 'onion', food, updatedAt });
      expect((await store.get('unobtainium'))?.food).toBeNull();
      expect(await store.get('missing')).toBeNull();
    });
  });

  describe('PgUserDataStore', () => {
    const now = new Date().toISOString();
    const plan = (id: string, userId: string | null, createdAt = now): StoredPlan => ({
      id,
      userId,
      version: 1,
      request: { allergies: ['peanuts'] },
      items: [],
      shoppingList: { householdSize: 1, sections: [], pantry: [], warnings: [] },
      checked: [],
      createdAt,
      updatedAt: createdAt,
    });

    it('stores profiles, plans and meals and erases a user completely', async () => {
      const store = new PgUserDataStore(database);
      await store.putProfile({ userId: 'u1', profile: { allergies: ['peanuts'] }, consentAt: now, createdAt: now, updatedAt: now });
      await store.putProfile({ userId: 'u1', profile: { allergies: ['sesame'] }, consentAt: now, createdAt: now, updatedAt: now });
      await store.createPlan(plan('11111111-1111-4111-8111-111111111111', 'u1'));
      await store.createPlan(plan('22222222-2222-4222-8222-222222222222', 'u2'));
      await store.addMeal({ id: 'm1', userId: 'u1', videoId: 'v1', planId: null, cooked: true, rating: 4, note: null, createdAt: now });

      expect((await store.getProfile('u1'))?.profile).toEqual({ allergies: ['sesame'] });
      expect(await store.listMeals('u1')).toHaveLength(1);
      expect(await store.deleteUser('u1')).toEqual({ profiles: 1, plans: 1, meals: 1 });
      expect(await store.getProfile('u1')).toBeNull();
      expect(await store.getPlan('22222222-2222-4222-8222-222222222222')).not.toBeNull();
    });

    it('updates plans optimistically', async () => {
      const store = new PgUserDataStore(database);
      const p = plan('33333333-3333-4333-8333-333333333333', null);
      await store.createPlan(p);
      expect(await store.updatePlan({ ...p, version: 2, checked: ['chickpea|g'] })).toBe(true);
      expect(await store.updatePlan({ ...p, version: 2, checked: [] })).toBe(false);
      expect((await store.getPlan(p.id))?.checked).toEqual(['chickpea|g']);
    });

    it('deletes old anonymous plans only', async () => {
      const store = new PgUserDataStore(database);
      const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
      await store.createPlan(plan('44444444-4444-4444-8444-444444444444', null, old));
      await store.createPlan(plan('55555555-5555-4555-8555-555555555555', 'u3', old));
      expect(await store.deleteAnonymousPlansBefore(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))).toBe(1);
    });
  });
});

