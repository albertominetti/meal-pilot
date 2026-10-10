import {
  expandAllergy,
  findAllergyMatches,
  haystackMatchesAllergy,
  mapToCanonicalAllergens,
} from './allergy.util';

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

  it('maps user free-text allergies to EU-14 canonical allergens', () => {
    expect(mapToCanonicalAllergens('peanut')).toContain('peanuts');
    expect(mapToCanonicalAllergens('shrimp')).toContain('crustaceans');
    expect(mapToCanonicalAllergens('clam')).toContain('molluscs');
    expect(mapToCanonicalAllergens('shellfish')).toEqual(
      expect.arrayContaining(['crustaceans', 'molluscs']),
    );
    expect(mapToCanonicalAllergens('celery stalk')).toContain('celery');
    expect(mapToCanonicalAllergens('dijon')).toContain('mustard');
    expect(mapToCanonicalAllergens('unknown exotic spice')).toEqual([]);
  });
});
