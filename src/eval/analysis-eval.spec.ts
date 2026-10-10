import { Ingredient } from '../videos/analyzers/analysis.schema';
import { ratio, scoreIngredients } from './analysis-eval';

function actual(name: string, quantity: number | null, unit: Ingredient['unit']): Ingredient {
  return { name, quantity, unit, rawText: name, confidence: 'high', source: 'video', packaged: false };
}

describe('scoreIngredients', () => {
  it('counts unit matches and quantities within ±20%', () => {
    const score = scoreIngredients(
      [
        { name: 'chickpea', quantity: 400, unit: 'g' },
        { name: 'garlic', quantity: 2, unit: 'clove' },
        { name: 'olive oil', quantity: 2, unit: 'tbsp' },
        { name: 'saffron', quantity: null, unit: 'pinch' },
      ],
      [
        actual('chickpea', 450, 'g'), // within 20%
        actual('garlic', 3, 'clove'), // unit ok, quantity off by 50%
        actual('olive oil', 30, 'ml'), // wrong unit
      ],
    );
    expect(score).toEqual({ matched: 3, unitCorrect: 2, quantityWithinTolerance: 1, expected: 4 });
  });

  it('matches each actual ingredient at most once', () => {
    const score = scoreIngredients(
      [
        { name: 'onion', quantity: 1, unit: 'piece' },
        { name: 'red onion', quantity: 1, unit: 'piece' },
      ],
      [actual('red onion', 1, 'piece')],
    );
    expect(score.matched).toBe(1);
  });

  it('ratio returns null for an empty denominator', () => {
    expect(ratio(1, 0)).toBeNull();
    expect(ratio(1, 4)).toBe(0.25);
  });
});
