import { expandAllergy, findAllergyMatches, haystackMatchesAllergy } from './allergy.util';

describe('allergy.util (safety-critical)', () => {
  it('normalizes plurals and aliases (peanuts -> peanut)', () => {
    expect(haystackMatchesAllergy('peanut sauce with noodles', 'peanuts')).toBe(true);
    expect(haystackMatchesAllergy('shrimp fried rice', 'shellfish')).toBe(true);
    expect(haystackMatchesAllergy('fresh garden salad', 'peanuts')).toBe(false);
  });

  it('finds all matching allergies', () => {
    const hits = findAllergyMatches('contains peanuts and shrimp', ['peanuts', 'shellfish', 'milk']);
    expect(hits).toEqual(expect.arrayContaining(['peanuts', 'shellfish']));
    expect(hits).not.toContain('milk');
  });

  it('expands tree-nut aliases', () => {
    const expanded = expandAllergy('tree nuts');
    expect(expanded.join(' ')).toMatch(/almond/);
  });
});
