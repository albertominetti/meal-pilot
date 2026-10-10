import { parseIsoDuration } from './youtube.interface';
import { FakeYouTubeService } from './fake-youtube.service';
import { YouTubeService } from './youtube.service';

describe('YouTubeService and helpers', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

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
    expect(details[0].description).toMatch(/lentils/);

    const searchResults = await fake.search('lentil soup');
    expect(searchResults.length).toBeGreaterThan(0);
  });

  it('maps channelId and description from the snippet in getDetails (1 unit)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          {
            id: 'v123',
            snippet: {
              title: 'Test Dish',
              channelTitle: 'Test Channel',
              channelId: 'UC12345',
              description: 'Ingredients: 400g chickpeas, 1 tsp salt.',
            },
            contentDetails: { duration: 'PT10M' },
            status: { privacyStatus: 'public', embeddable: true },
          },
        ],
      }),
    }) as unknown as typeof fetch;
    const service = new YouTubeService({ youtubeApiKey: 'k' } as any);

    const details = await service.getDetails(['v123']);
    expect(details).toHaveLength(1);
    expect(details[0].channelId).toBe('UC12345');
    expect(details[0].description).toBe('Ingredients: 400g chickpeas, 1 tsp salt.');
    expect(service.getQuotaUsage().unitsUsedToday).toBe(1);
    const url = (global.fetch as jest.Mock).mock.calls[0][0] as string;
    expect(url).toContain('part=snippet%2CcontentDetails%2Cstatus');
  });
});
