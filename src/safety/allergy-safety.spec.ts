import { makeAnalysis } from '../../test/fakes';
import { evaluateAllergySafety } from './allergy-safety';

describe('evaluateAllergySafety (safety table)', () => {
  const cases: Array<[string, Parameters<typeof makeAnalysis>[1], string[], string]> = [
    ['unavailable analysis', { status: 'unavailable', error: 'timeout' }, [], 'uncertain'],
    ['no allergies declared', {}, [], 'safe'],
    ['confirmed finding', { allergens: [{ allergen: 'peanuts', evidence: 'peanut butter at 02:10', confidence: 'confirmed' }] }, ['peanuts'], 'unsafe'],
    ['likely finding via umbrella term', { allergens: [{ allergen: 'crustaceans', evidence: 'shrimp paste', confidence: 'likely' }] }, ['shellfish'], 'unsafe'],
    ['possible finding', { allergens: [{ allergen: 'sesame', evidence: 'optional garnish', confidence: 'possible' }] }, ['sesame'], 'uncertain'],
    ['ingredient alias hit', { ingredients: [{ name: 'tahini' }] }, ['sesame'], 'unsafe'],
    ['hidden allergen in sodium sources', { sodiumSources: ['soy sauce'] }, ['gluten'], 'unsafe'],
    ['cross-contact note', { crossContactNotes: ['fried in oil also used for shrimp'] }, ['shellfish'], 'uncertain'],
    ['partial coverage + severe allergy', { coverage: 'partial' }, ['peanuts'], 'uncertain'],
    ['mock provider + severe allergy', { provider: 'mock', coverage: 'full' }, ['milk'], 'uncertain'],
    ['partial coverage + non-severe allergy', { coverage: 'partial' }, ['strawberries'], 'safe'],
    ['unrelated finding', { allergens: [{ allergen: 'milk', evidence: 'butter', confidence: 'confirmed' }] }, ['peanuts'], 'safe'],
    ['EU-14 extra: celery in stock', { allergens: [{ allergen: 'celery', evidence: 'vegetable stock', confidence: 'likely' }] }, ['celery'], 'unsafe'],
  ];

  it.each(cases)('%s', (_name, overrides, allergies, expected) => {
    expect(evaluateAllergySafety(makeAnalysis('abcdefghijk', overrides), allergies).status).toBe(expected);
  });

  it('unsafe beats uncertain', () => {
    const a = makeAnalysis('x', {
      allergens: [
        { allergen: 'peanuts', evidence: 'maybe', confidence: 'possible' },
        { allergen: 'peanuts', evidence: 'satay sauce', confidence: 'confirmed' },
      ],
    });
    expect(evaluateAllergySafety(a, ['peanut']).status).toBe('unsafe');
  });
});
