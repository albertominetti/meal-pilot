import { approximateGrams, formatAmount, roundToBuyingUnit, toBaseUnit } from './units';

describe('units', () => {
  it.each([
    [2, 'kg', { amount: 2000, unit: 'g' }],
    [1, 'l', { amount: 1000, unit: 'ml' }],
    [2, 'tbsp', { amount: 30, unit: 'ml' }],
    [1, 'tsp', { amount: 5, unit: 'ml' }],
    [1, 'cup', { amount: 240, unit: 'ml' }],
    [2, 'can', { amount: 2, unit: 'can' }],
    [3, 'clove', { amount: 3, unit: 'clove' }],
    [1, 'pinch', null],
  ] as const)('toBaseUnit(%s %s)', (q, unit, expected) => {
    expect(toBaseUnit(q, unit)).toEqual(expected);
  });

  it.each([
    [380, 'g', 400],
    [12, 'ml', 15],
    [55, 'g', 60],
    [1240, 'g', 1300],
    [1.3, 'can', 2],
    [2, 'clove', 2],
    [400, 'g', 400],
  ] as const)('roundToBuyingUnit(%s %s) -> %s', (amount, unit, expected) => {
    expect(roundToBuyingUnit(amount, unit)).toBe(expected);
  });

  it('formats large amounts as kg and l', () => {
    expect(formatAmount(1500, 'g')).toEqual({ amount: 1.5, unit: 'kg' });
    expect(formatAmount(900, 'ml')).toEqual({ amount: 900, unit: 'ml' });
  });

  it('approximates grams for ranking', () => {
    expect(approximateGrams(1, 'can', 'chickpea')).toBe(400);
    expect(approximateGrams(100, 'ml', 'olive oil')).toBeCloseTo(92);
    expect(approximateGrams(null, null, 'salt')).toBe(0);
  });
});
