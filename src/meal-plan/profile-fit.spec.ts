import { checkTime, matchGoals } from './profile-fit';

describe('profile fit', () => {
  describe('checkTime (hard filter when known)', () => {
    it.each([
      [undefined, 90, null],
      [30, undefined, null],
      [30, 30, true],
      [30, 31, false],
      [60, 15, true],
    ])('limit %s, prep %s -> fitsTime %s', (limit, prep, expected) => {
      expect(checkTime({ prepMinutes: prep }, limit).fitsTime).toBe(expected);
    });

    it('notes unknown prep time when a limit is set', () => {
      expect(checkTime({}, 30).note).toMatch(/unknown/);
    });

    it('explains the overrun', () => {
      expect(checkTime({ prepMinutes: 45 }, 30).note).toMatch(/45 min.*30-minute/);
    });
  });

  describe('matchGoals', () => {
    const analysis = {
      nutritionSignals: ['low-sodium', 'whole-foods'] as any,
      restrictionTags: ['high-protein'] as any,
    };

    it('matches goals against signals and restriction tags', () => {
      expect(matchGoals(analysis, ['high-protein', 'low-sodium', 'low-carb', 'low-sugar'])).toEqual({
        matched: ['high-protein', 'low-sodium'],
        missing: ['low-carb'],
        unverifiable: ['low-sugar'],
      });
    });

    it('handles no goals', () => {
      expect(matchGoals(analysis, undefined)).toEqual({ matched: [], missing: [], unverifiable: [] });
    });
  });
});
