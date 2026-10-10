import { feedbackFrom, isExcludedByRating } from './feedback';
import { MealLog } from './user-data.store';

const log = (videoId: string, createdAt: string, extra: Partial<MealLog> = {}): MealLog => ({
  id: createdAt,
  userId: 'u1',
  videoId,
  planId: null,
  cooked: true,
  rating: null,
  note: null,
  createdAt,
  ...extra,
});

describe('feedbackFrom', () => {
  it('keeps the latest rating and counts cooked meals', () => {
    const fb = feedbackFrom([
      log('a', '2026-10-03', { rating: 5 }),
      log('a', '2026-10-01', { rating: 2 }),
      log('a', '2026-10-02', { cooked: false }),
      log('b', '2026-10-01', { rating: 1, cooked: false }),
    ]);
    expect(fb.get('a')).toEqual({ userRating: 5, cookedCount: 2 });
    expect(fb.get('b')).toEqual({ userRating: 1, cookedCount: 0 });
    expect(isExcludedByRating(fb, 'b')).toBe(true);
    expect(isExcludedByRating(fb, 'a')).toBe(false);
    expect(isExcludedByRating(undefined, 'b')).toBe(false);
  });
});
