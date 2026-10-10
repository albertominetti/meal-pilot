import { mockAnalysis } from './mock-video-analyzer';

describe('mock analyzer (offline)', () => {
  it('derives tags from the title and is labeled mock/partial', () => {
    const out = mockAnalysis({ videoId: 'vid1', title: 'Vegan Quinoa Buddha Bowl', channel: 'Plant Table' });
    expect(out.provider).toBe('mock');
    expect(out.coverage).toBe('partial');
    expect(out.restrictionTags).toContain('vegan');
    expect(out.status).toBe('ok');
  });

  it('flags peanut content with an EU-14 allergen', () => {
    const out = mockAnalysis({ videoId: 'vid2', title: 'Peanut Satay Noodles', channel: 'Wok House' });
    expect(out.allergens.map((a) => a.allergen)).toContain('peanuts');
  });
});
