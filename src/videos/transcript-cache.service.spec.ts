import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TranscriptCacheService } from './transcript-cache.service';

describe('TranscriptCacheService', () => {
  it('persists and reads back entries without network', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mealpilot-cache-'));
    process.env.MEALPILOT_CACHE_DIR = dir;
    const svc = new TranscriptCacheService();
    expect(svc.get('missing')).toBeNull();

    svc.set({
      videoId: 'vid1',
      title: 'T',
      channel: 'C',
      transcript: 'hello',
      ingredients: ['rice'],
      nutritionSignals: ['low-sodium'],
      detectedAllergens: [],
      restrictionTags: ['vegan'],
      summary: 's',
      provider: 'mock',
      analyzedAt: new Date().toISOString(),
    });

    expect(svc.get('vid1')?.title).toBe('T');
    // New instance reads from disk.
    const svc2 = new TranscriptCacheService();
    expect(svc2.get('vid1')?.title).toBe('T');
    expect(svc2.list().length).toBe(1);
    svc2.clear();
    expect(svc2.list().length).toBe(0);
    delete process.env.MEALPILOT_CACHE_DIR;
  });
});
