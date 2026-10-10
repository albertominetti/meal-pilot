import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TranscriptCacheService } from './transcript-cache.service';
import { ANALYSIS_SCHEMA_VERSION, VideoAnalysis } from './analyzers/analysis.schema';

describe('TranscriptCacheService (v2)', () => {
  it('persists and reads back versioned entries', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mealpilot-cache-'));
    process.env.MEALPILOT_CACHE_DIR = dir;
    const svc = new TranscriptCacheService();
    expect(svc.get('missing', 'mock', 'mock')).toBeNull();

    const sampleEntry: VideoAnalysis = {
      videoId: 'vid1',
      title: 'T',
      channel: 'C',
      recipeName: 'T',
      transcript: 'hello',
      steps: ['step 1'],
      ingredients: [{ name: 'rice' }],
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

    svc.set(sampleEntry);

    const fetched = svc.get('vid1', 'mock', 'mock');
    expect(fetched?.title).toBe('T');
    expect(fetched?.schemaVersion).toBe(ANALYSIS_SCHEMA_VERSION);

    // New instance reads from disk
    const svc2 = new TranscriptCacheService();
    expect(svc2.get('vid1', 'mock', 'mock')?.title).toBe('T');
    expect(svc2.list().length).toBe(1);

    svc2.clear();
    expect(svc2.list().length).toBe(0);
    delete process.env.MEALPILOT_CACHE_DIR;
  });

  it('never persists unavailable results', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mealpilot-cache-'));
    process.env.MEALPILOT_CACHE_DIR = dir;
    const svc = new TranscriptCacheService();

    const unavailableEntry: VideoAnalysis = {
      videoId: 'bad-vid',
      title: 'Bad Video',
      channel: 'C',
      recipeName: 'Bad Video',
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

    svc.set(unavailableEntry);
    expect(svc.get('bad-vid', 'gemini', 'gemini-3.8-flash')).toBeNull();
    expect(svc.list().length).toBe(0);
    delete process.env.MEALPILOT_CACHE_DIR;
  });
});
