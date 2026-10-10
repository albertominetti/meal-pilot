import { sanitizeUntrusted } from './untrusted-text';

describe('sanitizeUntrusted', () => {
  it('strips control characters but keeps newlines and tabs', () => {
    expect(sanitizeUntrusted('a\u0000b\u0007c\nd\te', 100)).toBe('abc\nd\te');
  });

  it('caps the length and marks the cut', () => {
    expect(sanitizeUntrusted('x'.repeat(10), 4)).toBe('xxxx…');
  });

  it('returns an empty string for missing input', () => {
    expect(sanitizeUntrusted(undefined, 10)).toBe('');
  });
});
