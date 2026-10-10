import { canonicalAllergensFor, expandAllergy, findAllergyMatches, haystackMatchesAllergy } from './allergy.util';

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
    expect(expandAllergy('tree nuts').join(' ')).toMatch(/almond/);
  });

  it('maps free text to EU-14 canonical allergens', () => {
    // Substring matching is deliberately conservative: "shellfish" also maps to fish.
    expect(canonicalAllergensFor('shellfish')).toEqual(expect.arrayContaining(['crustaceans', 'molluscs']));
    expect(canonicalAllergensFor('Peanuts')).toEqual(['peanuts']);
    expect(canonicalAllergensFor('soy')).toContain('soybeans');
    expect(canonicalAllergensFor('wheat')).toContain('gluten');
    expect(canonicalAllergensFor('dairy')).toContain('milk');
    expect(canonicalAllergensFor('egg')).toContain('eggs');
    expect(canonicalAllergensFor('nuts')).toEqual(expect.arrayContaining(['peanuts', 'tree_nuts']));
    expect(canonicalAllergensFor('strawberries')).toEqual([]);
  });

  it('covers the newer EU allergens', () => {
    expect(haystackMatchesAllergy('celeriac puree', 'celery')).toBe(true);
    expect(haystackMatchesAllergy('dijon dressing', 'mustard')).toBe(true);
    expect(haystackMatchesAllergy('grilled calamari', 'molluscs')).toBe(true);
    expect(haystackMatchesAllergy('splash of white wine', 'sulphites')).toBe(true);
  });
});
