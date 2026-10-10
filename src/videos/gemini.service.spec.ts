import { GeminiService } from './gemini.service';

describe('GeminiService (offline mock)', () => {
  it('uses the mock provider when no API key is set', async () => {
    delete process.env.GEMINI_API_KEY;
    const svc = new GeminiService();
    expect(svc.provider()).toBe('mock');
    const out = await svc.analyzeVideo('vid1', 'Vegan Quinoa Buddha Bowl', 'Plant Table');
    expect(out.provider).toBe('mock');
    expect(out.restrictionTags).toContain('vegan');
    expect(out.transcript.length).toBeGreaterThan(0);
  });

  it('flags peanut content in mock data', async () => {
    delete process.env.GEMINI_API_KEY;
    const svc = new GeminiService();
    const out = await svc.analyzeVideo('vid2', 'Peanut Satay Noodles', 'Wok House');
    expect(out.detectedAllergens).toContain('peanuts');
  });
});
