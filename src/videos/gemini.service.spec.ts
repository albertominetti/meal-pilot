import { ANALYSIS_SCHEMA_VERSION, IngredientSchema } from './analyzers/analysis.schema';
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

  it('returns valid Schema v3 output from MockVideoAnalyzer via analyzeVideo', async () => {
    delete process.env.GEMINI_API_KEY;
    const svc = new GeminiService();
    const out = await svc.analyzeVideo('vid3', 'Quick Garlic Pasta', 'Italian Cooking');
    expect(out.schemaVersion).toBe(ANALYSIS_SCHEMA_VERSION);
    expect(out.schemaVersion).toBe(3);
    expect(typeof out.prepMinutes).toBe('number');
    expect(out.prepMinutes).toBe(15);
    expect(Array.isArray(out.labelCheck)).toBe(true);
    expect(out.labelCheck).toContain('vegetable broth');
    expect(out.ingredients.length).toBeGreaterThan(0);
    for (const i of out.ingredients) {
      expect(() => IngredientSchema.parse(i)).not.toThrow();
      expect(i).toHaveProperty('name');
      expect(i).toHaveProperty('quantity');
      expect(i).toHaveProperty('unit');
      expect(i).toHaveProperty('rawText');
      expect(i).toHaveProperty('confidence');
      expect(i).toHaveProperty('source');
      expect(i).toHaveProperty('packaged');
    }
  });

  it('returns valid Schema v3 output from mockAnalysis helper', () => {
    const svc = new GeminiService();
    const out = svc.mockAnalysis('Quick Vegetable Pasta', 'Chef Mario');
    expect(out.schemaVersion).toBe(ANALYSIS_SCHEMA_VERSION);
    expect(out.schemaVersion).toBe(3);
    expect(typeof out.prepMinutes).toBe('number');
    expect(Array.isArray(out.labelCheck)).toBe(true);
    expect(out.labelCheck).toContain('vegetable broth');
    expect(out.ingredients.length).toBeGreaterThan(0);
    for (const i of out.ingredients) {
      expect(() => IngredientSchema.parse(i)).not.toThrow();
      expect(i).toHaveProperty('name');
      expect(i).toHaveProperty('quantity');
      expect(i).toHaveProperty('unit');
      expect(i).toHaveProperty('rawText');
      expect(i).toHaveProperty('confidence');
      expect(i).toHaveProperty('source');
      expect(i).toHaveProperty('packaged');
    }
  });
});
