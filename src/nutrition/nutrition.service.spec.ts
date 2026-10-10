import { analysis, ingredient } from '../../test/fixtures/analysis';
import { FdcFood } from './fdc-food';
import { FdcMapping, FdcMappingStore } from './fdc-mapping.store';
import { FdcClient } from './fdc.client';
import { NutritionService } from './nutrition.service';

const lentils: FdcFood = {
  fdcId: 172420,
  description: 'Lentils, raw',
  dataType: 'SR Legacy',
  nutrients: { kcal: 352, protein: 24.6, fat: 1.1, saturatedFat: 0.2, carbs: 63.4, sugar: 2, fiber: 10.7, sodium: 6 },
  portions: [],
};
const coconutMilk: FdcFood = { ...lentils, fdcId: 999, description: 'Nuts, coconut milk, canned' };

class FakeFdc implements FdcClient {
  enabled = true;
  searches: string[] = [];
  down = false;
  async search(query: string): Promise<FdcFood[]> {
    this.searches.push(query);
    if (this.down) throw new Error('FDC request failed (503)');
    return query.startsWith('lentil') ? [{ ...lentils, portions: [] }] : [];
  }
  async foods(ids: number[]): Promise<FdcFood[]> {
    return ids.map((id) => (id === 999 ? coconutMilk : lentils));
  }
}

class MemoryStore implements FdcMappingStore {
  entries = new Map<string, FdcMapping>();
  async get(key: string) {
    return this.entries.get(key) ?? null;
  }
  async set(m: FdcMapping) {
    this.entries.set(m.key, m);
  }
}

describe('NutritionService', () => {
  const soup = () =>
    analysis({
      servings: 2,
      ingredients: [
        ingredient('lentil', 200, 'g'),
        ingredient('coconut milk', 200, 'g'),
        ingredient('olive oil', 1, 'tbsp', { confidence: 'low' }),
      ],
    });

  it('computes nutrients, uses overrides and caches mappings for every video', async () => {
    const fdc = new FakeFdc();
    const store = new MemoryStore();
    const svc = new NutritionService(fdc, store, { 'coconut milk': { fdcId: 999 } });

    const first = await svc.ensure(soup());
    expect(first.nutrition?.perServing?.protein).toBeCloseTo(49.2);
    expect(fdc.searches).toEqual(['lentil']); // override needs no search; low confidence needs no lookup
    expect(store.entries.get('coconut milk')?.food?.fdcId).toBe(999);

    await svc.ensure(soup());
    expect(fdc.searches).toEqual(['lentil']);
  });

  it('remembers ingredients with no match', async () => {
    const fdc = new FakeFdc();
    const svc = new NutritionService(fdc, new MemoryStore(), {});
    const a = analysis({ ingredients: [ingredient('unobtainium', 100, 'g')] });
    expect((await svc.ensure(a)).nutrition?.unresolved).toEqual(['unobtainium']);
    await svc.ensure(a);
    expect(fdc.searches).toEqual(['unobtainium']);
  });

  it('returns the analysis with nutrition null when FDC is down', async () => {
    const fdc = new FakeFdc();
    fdc.down = true;
    const out = await new NutritionService(fdc, new MemoryStore(), {}).ensure(soup());
    expect(out.nutrition).toBeNull();
    expect(out.ingredients).toHaveLength(3);
  });

  it('does nothing without an FDC key or for current nutrients', async () => {
    const fdc = new FakeFdc();
    fdc.enabled = false;
    const a = soup();
    expect(await new NutritionService(fdc, new MemoryStore(), {}).ensure(a)).toBe(a);

    fdc.enabled = true;
    const svc = new NutritionService(fdc, new MemoryStore(), { 'coconut milk': { fdcId: 999 } });
    const done = await svc.ensure(a);
    expect(await svc.ensure(done)).toBe(done);
  });

  it('searches canned products as canned', async () => {
    const fdc = new FakeFdc();
    await new NutritionService(fdc, new MemoryStore(), {}).ensure(
      analysis({ ingredients: [ingredient('chickpea', 1, 'can')] }),
    );
    expect(fdc.searches).toEqual(['chickpea canned']);
  });
});
