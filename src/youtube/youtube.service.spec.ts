import { parseIsoDuration } from './youtube.interface';
import { FakeYouTubeService } from './fake-youtube.service';

describe('YouTubeService and helpers', () => {
  it('parses ISO 8601 duration correctly', () => {
    expect(parseIsoDuration('PT15M33S')).toBe(15 * 60 + 33);
    expect(parseIsoDuration('PT1H2M3S')).toBe(3600 + 2 * 60 + 3);
    expect(parseIsoDuration('PT45S')).toBe(45);
    expect(parseIsoDuration('PT10M')).toBe(600);
    expect(parseIsoDuration('')).toBe(0);
  });

  it('FakeYouTubeService retrieves details and filters properly', async () => {
    const fake = new FakeYouTubeService();
    const details = await fake.getDetails(['jfKL8pQjBCA']);
    expect(details.length).toBe(1);
    expect(details[0].title).toContain('Lentil');
    expect(details[0].embeddable).toBe(true);

    const searchResults = await fake.search('lentil soup');
    expect(searchResults.length).toBeGreaterThan(0);
  });
});
