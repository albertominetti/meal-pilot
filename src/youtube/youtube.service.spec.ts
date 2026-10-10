import { AppConfig } from '../config/app-config.service';
import { YouTubeError, YouTubeService, parseIsoDuration } from './youtube.service';

describe('YouTubeService', () => {
  const saved = { ...process.env };
  const realFetch = global.fetch;
  afterEach(() => {
    process.env = { ...saved };
    global.fetch = realFetch;
  });

  it('parses ISO-8601 durations', () => {
    expect(parseIsoDuration('PT12M5S')).toBe(725);
    expect(parseIsoDuration('PT1H')).toBe(3600);
    expect(parseIsoDuration('P0D')).toBe(0);
    expect(parseIsoDuration('garbage')).toBe(0);
  });

  it('is disabled without a key', async () => {
    delete process.env.YOUTUBE_API_KEY;
    const yt = new YouTubeService(new AppConfig());
    expect(yt.isEnabled()).toBe(false);
    await expect(yt.search('soup')).rejects.toBeInstanceOf(YouTubeError);
  });

  it('searches, enriches, filters non-public/too-long and caches', async () => {
    process.env.YOUTUBE_API_KEY = 'k';
    const calls: string[] = [];
    global.fetch = jest.fn(async (url: any) => {
      calls.push(String(url));
      const u = new URL(String(url));
      if (u.pathname.endsWith('/search')) {
        return new Response(JSON.stringify({ items: ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc'].map((videoId) => ({ id: { videoId } })) }));
      }
      return new Response(
        JSON.stringify({
          items: [
            { id: 'aaaaaaaaaaa', snippet: { title: 'Soup', channelTitle: 'C' }, contentDetails: { duration: 'PT10M' }, status: { privacyStatus: 'public' } },
            { id: 'bbbbbbbbbbb', snippet: { title: 'Long', channelTitle: 'C' }, contentDetails: { duration: 'PT1H' }, status: { privacyStatus: 'public' } },
            { id: 'ccccccccccc', snippet: { title: 'Hidden', channelTitle: 'C' }, contentDetails: { duration: 'PT5M' }, status: { privacyStatus: 'unlisted' } },
          ],
        }),
      );
    }) as any;
    const yt = new YouTubeService(new AppConfig());
    const res = await yt.search('low sodium soup');
    expect(res.map((r) => r.videoId)).toEqual(['aaaaaaaaaaa']);
    expect(yt.quota().used).toBe(101);
    await yt.search('Low  sodium soup');
    expect(calls).toHaveLength(2); // search + details cached
    expect(calls[0]).toContain('safeSearch=strict');
  });

  it('enforces the daily quota guard', async () => {
    process.env.YOUTUBE_API_KEY = 'k';
    process.env.YOUTUBE_DAILY_QUOTA = '150';
    global.fetch = jest.fn(async () => new Response(JSON.stringify({ items: [] }))) as any;
    const yt = new YouTubeService(new AppConfig());
    await yt.search('a soup');
    await expect(yt.search('another soup')).rejects.toMatchObject({ code: 'quota_exceeded' });
  });
});
