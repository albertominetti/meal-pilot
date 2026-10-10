import { buildEvidence } from './evidence';
import { analysis, ingredient } from '../../test/fixtures/analysis';

describe('buildEvidence', () => {
  it('names the ingredients behind each matched goal', () => {
    const e = buildEvidence(
      analysis({
        ingredients: [
          ingredient('tofu', 200, 'g'),
          ingredient('chickpea', 400, 'g'),
          ingredient('rice', 150, 'g'),
          ingredient('peanut', null, null),
        ],
        sodiumSources: ['soy sauce'],
        nutritionSignals: ['high-protein', 'low-sodium'],
      }),
      ['high-protein', 'low-sodium', 'low-carb'],
      { notes: 'No match for declared allergies.' },
    );
    expect(e.goals[0]).toEqual({ goal: 'high-protein', ingredients: ['chickpea 400 g', 'tofu 200 g'] });
    expect(e.goals[1].note).toMatch(/soy sauce/);
    expect(e.goals[2]).toMatchObject({ ingredients: ['rice 150 g'], note: 'Starchy ingredients present' });
    expect(e.allergens).toBe('No match for declared allergies.');
    expect(e.basis).toBe('model-signals');
  });
});
