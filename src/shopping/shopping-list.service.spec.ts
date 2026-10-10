import { analysis, ingredient } from '../../test/fixtures/analysis';
import { ShoppingListService } from './shopping-list.service';

describe('ShoppingListService', () => {
  const soup = analysis({ videoId: 'soup', servings: 2, ingredients: [ingredient('lentil', 200, 'g')] });
  const cache = {
    get: jest.fn((id: string) => (id === 'soup' ? soup : null)),
    list: jest.fn(() => [analysis({ videoId: 'other-model', servings: 1, ingredients: [ingredient('rice', 100, 'g')] })]),
  };
  const analyzer = { provider: () => 'mock', model: () => 'mock', analyze: jest.fn() };
  const svc = new ShoppingListService(cache as any, analyzer as any);

  it('builds from cached analyses and never analyses', () => {
    const list = svc.fromCache({ items: [{ videoId: 'soup' }], householdSize: 4 });
    expect(list.sections[0].items[0]).toMatchObject({ name: 'lentil', exactAmount: 400 });
    expect(analyzer.analyze).not.toHaveBeenCalled();
  });

  it('falls back to analyses cached under another model', () => {
    const list = svc.fromCache({ items: [{ videoId: 'other-model' }] });
    expect(list.sections[0].items[0].name).toBe('rice');
  });

  it('warns about videos that were never analysed', () => {
    const list = svc.fromCache({ items: [{ videoId: 'soup' }, { videoId: 'nope' }] });
    expect(list.warnings[0]).toMatch(/No analysis cached for nope/);
  });
});
