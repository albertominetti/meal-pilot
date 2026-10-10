import { parseNutrients, parsePortions } from './fdc-food';

describe('FDC response parsing', () => {
  it('reads search-hit nutrients', () => {
    expect(
      parseNutrients([
        { nutrientNumber: '208', unitName: 'KCAL', value: 40 },
        { nutrientNumber: '203', unitName: 'G', value: 1.1 },
        { nutrientNumber: '307', unitName: 'MG', value: 4 },
      ]),
    ).toEqual({ kcal: 40, protein: 1.1, sodium: 4 });
  });

  it('reads full and abridged detail nutrients', () => {
    expect(parseNutrients([{ nutrient: { number: '204', unitName: 'g' }, amount: 14 }])).toEqual({ fat: 14 });
    expect(parseNutrients([{ number: '291', unitName: 'g', amount: 7.6 }])).toEqual({ fiber: 7.6 });
  });

  it('falls back to Atwater energy and NLEA sugars, and never reads kJ as kcal', () => {
    expect(
      parseNutrients([
        { nutrientNumber: '208', unitName: 'kJ', value: 1500 },
        { nutrientNumber: '957', unitName: 'KCAL', value: 383 },
        { nutrientNumber: '269.3', unitName: 'G', value: 10.7 },
      ]),
    ).toEqual({ kcal: 383, sugar: 10.7 });
  });

  it('labels portions from unit name, modifier and description', () => {
    expect(
      parsePortions([
        { amount: 1, gramWeight: 3, modifier: 'clove', measureUnit: { name: 'undetermined' } },
        { amount: 1, gramWeight: 160, modifier: 'chopped', measureUnit: { name: 'cup' } },
        { amount: 1, gramWeight: 0, modifier: 'bogus' },
      ]),
    ).toEqual([
      { label: '1 clove', amount: 1, gramWeight: 3 },
      { label: '1 cup, chopped', amount: 1, gramWeight: 160 },
    ]);
  });
});
