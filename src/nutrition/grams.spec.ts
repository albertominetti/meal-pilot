import { ingredient } from '../../test/fixtures/analysis';
import { Portion } from './fdc-food';
import { resolveGrams } from './grams';

const garlic: Portion[] = [
  { label: '1 cup', amount: 1, gramWeight: 136 },
  { label: '1 clove', amount: 1, gramWeight: 3 },
];
const onion: Portion[] = [
  { label: '1 cup, chopped', amount: 1, gramWeight: 160 },
  { label: '1 large', amount: 1, gramWeight: 150 },
  { label: '1 medium (2-1/2" dia)', amount: 1, gramWeight: 110 },
];

describe('resolveGrams', () => {
  it.each([
    ['mass', ingredient('lentil', 0.2, 'kg'), [], 200],
    ['density table', ingredient('olive oil', 2, 'tbsp'), [], 27.6],
    ['volume through a cup portion', ingredient('garlic', 2, 'tbsp'), garlic, 17],
    ['clove portion', ingredient('garlic', 3, 'clove'), garlic, 9],
    ['medium before large for a piece', ingredient('onion', 2, 'piece'), onion, 220],
    ['label weight for one can', ingredient('chickpea', 1, 'can', { rawText: '1 can (400g) chickpeas' }), [], 400],
  ])('%s', (_label, i, portions, grams) => {
    const result = resolveGrams(i, portions as Portion[]);
    expect(result.grams).toBeCloseTo(grams as number, 1);
  });

  it.each([
    ['low confidence', ingredient('olive oil', 2, 'tbsp', { confidence: 'low' })],
    ['no amount', ingredient('salt', null, null)],
    ['pinch', ingredient('salt', 1, 'pinch')],
    ['volume without density or portion', ingredient('soy sauce', 2, 'tbsp')],
    ['two cans: the label weight may be the total', ingredient('chickpea', 2, 'can', { rawText: '2 cans (400g)' })],
  ])('leaves %s unresolved', (_label, i) => {
    expect(resolveGrams(i, []).grams).toBeNull();
  });
});
