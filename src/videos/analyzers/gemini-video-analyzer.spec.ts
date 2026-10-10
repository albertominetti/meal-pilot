import { AppConfig } from '../../config/app-config.service';
import { LlmError } from '../../llm/llm-client';
import { ScriptedLlmClient, okAnalysisJson } from '../../../test/fakes';
import { GeminiVideoAnalyzer } from './gemini-video-analyzer';

const ref = { videoId: 'abcdefghijk', title: 'Lentil Soup', channel: 'Kitchen' };
const text = (t: string) => ({ steps: [], text: t, functionCalls: [] });

describe('GeminiVideoAnalyzer', () => {
  it('sends the YouTube URL as video input with a JSON schema and parses the result', async () => {
    const llm = new ScriptedLlmClient([text(okAnalysisJson())]);
    const out = await new GeminiVideoAnalyzer(llm, new AppConfig()).analyze(ref);
    expect(out.status).toBe('ok');
    expect(out.provider).toBe('gemini');
    expect(out.restrictionTags).toContain('vegan');
    const req = llm.requests[0];
    expect(req.responseSchema).toBeDefined();
    expect(req.input).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'video', uri: 'https://www.youtube.com/watch?v=abcdefghijk' })]),
    );
  });

  it('retries once on schema violations, then succeeds', async () => {
    const llm = new ScriptedLlmClient([text('{"recipeName": 1}'), text(okAnalysisJson())]);
    const out = await new GeminiVideoAnalyzer(llm, new AppConfig()).analyze(ref);
    expect(out.status).toBe('ok');
    expect(llm.requests).toHaveLength(2);
    expect(JSON.stringify(llm.requests[1].input)).toMatch(/previous answer was invalid/);
  });

  it('returns unavailable (never mock) after two invalid answers', async () => {
    const llm = new ScriptedLlmClient([text('nope'), text('still nope')]);
    const out = await new GeminiVideoAnalyzer(llm, new AppConfig()).analyze(ref);
    expect(out).toMatchObject({ status: 'unavailable', error: 'invalid_model_output', provider: 'gemini' });
  });

  it('maps API failures to unavailable with the error code', async () => {
    const llm = new ScriptedLlmClient([new LlmError('video_not_accessible', 'private video')]);
    const out = await new GeminiVideoAnalyzer(llm, new AppConfig()).analyze(ref);
    expect(out).toMatchObject({ status: 'unavailable', error: 'video_not_accessible' });
    expect(out.ingredients).toEqual([]);
  });

  it('rejects allergens outside the EU-14 enum', async () => {
    const bad = okAnalysisJson({ allergens: [{ allergen: 'peanut butter', evidence: 'x', confidence: 'confirmed' }] });
    const llm = new ScriptedLlmClient([text(bad), text(bad)]);
    const out = await new GeminiVideoAnalyzer(llm, new AppConfig()).analyze(ref);
    expect(out.status).toBe('unavailable');
  });
});
