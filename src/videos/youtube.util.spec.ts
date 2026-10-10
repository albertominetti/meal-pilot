import { extractVideoId, watchUrl } from './youtube.util';

describe('youtube.util', () => {
  it('passes through plain ids', () => {
    expect(extractVideoId('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('parses watch, youtu.be, shorts and embed URLs', () => {
    expect(extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(extractVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(extractVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(extractVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('returns null for garbage', () => {
    expect(extractVideoId('not a url !!!')).toBeNull();
    expect(extractVideoId('')).toBeNull();
  });

  it('builds watch urls', () => {
    expect(watchUrl('abc123')).toBe('https://www.youtube.com/watch?v=abc123');
  });
});
