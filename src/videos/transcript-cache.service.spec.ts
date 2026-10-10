import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { makeAnalysis } from '../../test/fakes';
import { TranscriptCacheService } from './transcript-cache.service';

describe('TranscriptCacheService (v2)', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mealpilot-cache-'));
    process.env.MEALPILOT_CACHE_DIR = dir;
    delete process.env.CACHE_TTL_DAYS;
  });
  afterAll(() => {
    delete process.env.MEALPILOT_CACHE_DIR;
    delete process.env.CACHE_TTL_DAYS;
  });

  it('persists and reads back entries keyed by provider + model', () => {
    const svc = new TranscriptCacheService();
    expect(svc.get('vid1', 'gemini', 'gemini-3.8-flash')).toBeNull();
    svc.set(makeAnalysis('vid1'));
    expect(svc.get('vid1', 'gemini', 'gemini-3.8-flash')?.title).toBe('Video vid1');
    // Different provider or model -> miss (mock results never served in live mode).
    expect(svc.get('vid1', 'mock', 'mock')).toBeNull();
    expect(svc.get('vid1', 'gemini', 'gemini-3.5-flash-lite')).toBeNull();
    const svc2 = new TranscriptCacheService();
    expect(svc2.get('vid1', 'gemini', 'gemini-3.8-flash')?.title).toBe('Video vid1');
    expect(svc2.list().length).toBe(1);
    expect(svc2.list({ provider: 'mock' }).length).toBe(0);
  });

  it('never persists unavailable analyses', () => {
    const svc = new TranscriptCacheService();
    svc.set(makeAnalysis('bad', { status: 'unavailable', error: 'timeout' }));
    expect(fs.readdirSync(dir)).toEqual([]);
    expect(svc.get('bad', 'gemini', 'gemini-3.8-flash')).toBeNull();
  });

  it('ignores legacy files and old schema versions, honors TTL', () => {
    fs.writeFileSync(path.join(dir, 'legacy.json'), JSON.stringify({ videoId: 'legacy' }));
    const svc = new TranscriptCacheService();
    svc.set(makeAnalysis('old', { analyzedAt: new Date(Date.now() - 40 * 86_400_000).toISOString() }));
    expect(svc.list().map((e) => e.videoId)).toEqual([]);
    process.env.CACHE_TTL_DAYS = '0';
    expect(svc.list().map((e) => e.videoId)).toEqual(['old']);
  });

  it('clears one video (all variants) or everything', () => {
    const svc = new TranscriptCacheService();
    svc.set(makeAnalysis('a'));
    svc.set(makeAnalysis('a', { provider: 'mock', model: 'mock' }));
    svc.set(makeAnalysis('b'));
    expect(svc.clear('a').cleared).toBe(2);
    expect(svc.list().map((e) => e.videoId)).toEqual(['b']);
    svc.clear();
    expect(svc.list()).toEqual([]);
  });
});
