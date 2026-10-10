import { functionResultStep } from './llm-client';
import { normalizeInteraction, toLlmError } from './genai-llm-client';

describe('GenAiLlmClient helpers', () => {
  it('normalizes an interaction with thought + function calls', () => {
    const res = normalizeInteraction({
      id: 'int_1',
      status: 'requires_action',
      steps: [
        { type: 'user_input', content: [{ type: 'text', text: 'hi' }] },
        { type: 'thought', signature: 'abc' },
        { type: 'function_call', id: 'c1', name: 'analyze_video', arguments: { videoId: 'x' } },
      ],
      usage: { total_input_tokens: 10, total_output_tokens: 5, total_tokens: 15 },
    });
    expect(res.steps.map((s) => s.type)).toEqual(['thought', 'function_call']);
    expect(res.functionCalls).toEqual([{ id: 'c1', name: 'analyze_video', arguments: { videoId: 'x' } }]);
    expect(res.usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
  });

  it('extracts text from output_text or model_output steps', () => {
    expect(normalizeInteraction({ output_text: '{"a":1}', steps: [] }).text).toBe('{"a":1}');
    expect(
      normalizeInteraction({ steps: [{ type: 'model_output', content: [{ type: 'text', text: 'he' }, { type: 'text', text: 'llo' }] }] }).text,
    ).toBe('hello');
  });

  it('maps errors to retryable / non-retryable codes', () => {
    expect(toLlmError({ status: 429, message: 'quota' })).toMatchObject({ code: 'rate_limited', retryable: true });
    expect(toLlmError({ status: 503, message: 'down' })).toMatchObject({ code: 'unavailable', retryable: true });
    expect(toLlmError({ status: 400, message: 'bad' })).toMatchObject({ code: 'bad_request', retryable: false });
    expect(toLlmError({ status: 400, message: 'The YouTube video is private' })).toMatchObject({ code: 'video_not_accessible' });
    expect(toLlmError(new Error('fetch failed'))).toMatchObject({ code: 'timeout', retryable: true });
  });

  it('builds function_result steps', () => {
    const step = functionResultStep({ id: 'c1', name: 't', arguments: {} }, { ok: 1 });
    expect(step).toMatchObject({ type: 'function_result', call_id: 'c1', name: 't', result: [{ type: 'text', text: '{"ok":1}' }] });
  });
});
