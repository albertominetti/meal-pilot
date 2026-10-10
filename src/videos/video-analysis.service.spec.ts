import { MockVideoAnalyzer } from './analyzers/mock-video-analyzer';
import { VideoAnalysisService } from './video-analysis.service';
import { FakeYouTubeService } from '../youtube/fake-youtube.service';

function build(cached: unknown = null) {
  const cache = { get: jest.fn().mockReturnValue(cached), set: jest.fn() };
  const analyzer = new MockVideoAnalyzer();
  const analyze = jest.spyOn(analyzer, 'analyze');
  const youtube = new FakeYouTubeService();
  const getDetails = jest.spyOn(youtube, 'getDetails');
  const svc = new VideoAnalysisService(
    cache as any,
    analyzer,
    { effectiveLlmMode: 'mock' } as any,
    youtube,
  );
  return { svc, analyze, getDetails };
}

describe('VideoAnalysisService description enrichment', () => {
  it('fetches details on a cache miss and passes the description to the analyzer', async () => {
    const { svc, analyze, getDetails } = build();
    const { analysis } = await svc.analyzeWithMeta({
      videoId: 'tofu-curry-05',
      title: 'YouTube video tofu-curry-05',
      channel: 'Unknown channel',
    });
    expect(getDetails).toHaveBeenCalledWith(['tofu-curry-05']);
    const target = analyze.mock.calls[0][0];
    expect(target.title).toBe('Easy Vegetarian Tofu Curry');
    expect(target.channelId).toBe('UC_spice_route');
    expect(target.description).toMatch(/peanut sauce/);
    expect(analysis.ingredients.some((i) => i.source === 'description')).toBe(true);
  });

  it('does not call YouTube when the description is already known', async () => {
    const { svc, getDetails } = build();
    await svc.analyzeWithMeta({ videoId: 'x', title: 'T', channel: 'C', description: '' });
    expect(getDetails).not.toHaveBeenCalled();
  });

  it('does not call YouTube or the analyzer on a cache hit', async () => {
    const { svc, analyze, getDetails } = build({ videoId: 'x' });
    const res = await svc.analyzeWithMeta({ videoId: 'x', title: 'T', channel: 'C' });
    expect(res.fromCache).toBe(true);
    expect(getDetails).not.toHaveBeenCalled();
    expect(analyze).not.toHaveBeenCalled();
  });
});
