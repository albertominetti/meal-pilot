import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileAnalysisStore } from './file-analysis.store';
import { ANALYSIS_SCHEMA_VERSION, VideoAnalysis } from './analyzers/analysis.schema';

describe('FileAnalysisStore', () => {
  it('persists and reads back versioned entries', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mealpilot-cache-'));
    process.env.MEALPILOT_CACHE_DIR = dir;
    const svc = new FileAnalysisStore();
    expect(await svc.get('missing', 'mock', 'mock')).toBeNull();

    const sampleEntry: VideoAnalysis = {
      videoId: 'vid1',
      title: 'T',
      channel: 'C',
      recipeName: 'T',
      transcript: 'hello',
      steps: ['step 1'],
      prepMinutes: 30,
      mainProtein: 'none',
      cuisine: 'mediterranean',
      mealType: ['lunch', 'dinner'],
      ingredients: [
        {
          name: 'rice',
          quantity: 150,
          unit: 'g',
          rawText: '150g rice',
          confidence: 'high',
          source: 'video',
          packaged: false,
        },
        {
          name: 'vegetable broth',
          quantity: 500,
          unit: 'ml',
          rawText: '500ml vegetable broth',
          confidence: 'high',
          source: 'description',
          packaged: true,
        },
      ],
      labelCheck: ['vegetable broth'],
      nutritionSignalsSource: 'model',
      allergens: [],
      crossContactNotes: [],
      sodiumSources: [],
      nutritionSignals: ['low-sodium'],
      detectedAllergens: [],
      restrictionTags: ['vegan'],
      summary: 's',
      coverage: 'full',
      status: 'ok',
      provider: 'mock',
      model: 'mock',
      schemaVersion: ANALYSIS_SCHEMA_VERSION,
      analyzedAt: new Date().toISOString(),
    };

    await svc.set(sampleEntry);

    const fetched = await svc.get('vid1', 'mock', 'mock');
    expect(fetched?.title).toBe('T');
    expect(fetched?.schemaVersion).toBe(ANALYSIS_SCHEMA_VERSION);

    // New instance reads from disk
    const svc2 = new FileAnalysisStore();
    expect((await svc2.get('vid1', 'mock', 'mock'))?.title).toBe('T');
    expect((await svc2.list()).length).toBe(1);

    fs.writeFileSync(path.join(dir, 'fdc-mappings.json'), '{}');
    await svc2.clear();
    expect((await svc2.list()).length).toBe(0);
    // Other stores share the directory; clearing analyses leaves them alone.
    expect(fs.existsSync(path.join(dir, 'fdc-mappings.json'))).toBe(true);
    delete process.env.MEALPILOT_CACHE_DIR;
  });

  it('never persists unavailable results', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mealpilot-cache-'));
    process.env.MEALPILOT_CACHE_DIR = dir;
    const svc = new FileAnalysisStore();

    const unavailableEntry: VideoAnalysis = {
      videoId: 'bad-vid',
      title: 'Bad Video',
      channel: 'C',
      recipeName: 'Bad Video',
      prepMinutes: 0,
      mainProtein: 'none',
      cuisine: 'other',
      mealType: [],
      labelCheck: [],
      nutritionSignalsSource: 'model',
      transcript: '',
      steps: [],
      ingredients: [],
      allergens: [],
      crossContactNotes: [],
      sodiumSources: [],
      nutritionSignals: [],
      detectedAllergens: [],
      restrictionTags: [],
      summary: 'Analysis unavailable',
      coverage: 'partial',
      status: 'unavailable',
      error: 'video_not_public',
      provider: 'gemini',
      model: 'gemini-3.8-flash',
      schemaVersion: ANALYSIS_SCHEMA_VERSION,
      analyzedAt: new Date().toISOString(),
    };

    await svc.set(unavailableEntry);
    expect(await svc.get('bad-vid', 'gemini', 'gemini-3.8-flash')).toBeNull();
    expect((await svc.list()).length).toBe(0);
    delete process.env.MEALPILOT_CACHE_DIR;
  });
});
