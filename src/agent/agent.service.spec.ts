import { LlmError } from '../llm/llm-client';
import {
  FakeYouTube,
  ScriptedLlmClient,
  buildTestingModule,
  callTurn,
  okAnalysisJson,
  textTurn,
  ytVideo,
} from '../../test/fakes';
import { AgentService } from './agent.service';

const SOUP = 'soupsoup001';
const SATAY = 'satay000001';
const SALAD = 'salad000001';

/** Per-video analysis results the fake Gemini returns. */
function analyses(url: string): string {
  if (url.endsWith(SATAY)) {
    return okAnalysisJson({
      recipeName: 'Chicken Satay',
      ingredients: [{ name: 'chicken' }, { name: 'peanut butter' }],
      allergens: [{ allergen: 'peanuts', evidence: 'peanut butter at 01:20', confidence: 'confirmed' }],
      restrictionTags: [],
    });
  }
  if (url.endsWith(SALAD)) return okAnalysisJson({ recipeName: 'Quinoa Salad' });
  return okAnalysisJson();
}

const youtube = () =>
  new FakeYouTube([ytVideo(SOUP, 'Low Sodium Lentil Soup'), ytVideo(SATAY, 'Chicken Satay'), ytVideo(SALAD, 'Quinoa Salad')]);

const profile = {
  healthProfile: 'hypertension',
  bloodPressure: '145/95',
  restrictions: ['vegetarian'],
  allergies: ['peanuts'],
  maxResults: 2,
  debug: true,
};

async function agentWith(llm: ScriptedLlmClient, yt = youtube()) {
  const moduleRef = await buildTestingModule({ llm, youtube: yt });
  return { agent: moduleRef.get(AgentService), yt };
}

describe('AgentService', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.MEALPILOT_LLM_MODE = 'live';
    process.env.GEMINI_API_KEY = 'test';
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it('happy path: list -> search -> parallel analyze -> submit', async () => {
    const llm = new ScriptedLlmClient(
      [
        callTurn(['list_known_videos', {}]),
        callTurn(['search_videos', { query: 'low sodium vegetarian dinner' }]),
        callTurn(['analyze_video', { videoId: SOUP }], ['analyze_video', { videoId: SATAY }], ['analyze_video', { videoId: SALAD }]),
        callTurn([
          'submit_plan',
          {
            recommendations: [
              { videoId: SOUP, whyItFits: 'Vegan lentil soup with no added salt suits your blood pressure goals.' },
              { videoId: SALAD, whyItFits: 'Quinoa salad is vegetarian, fibre-rich and quick to prepare.', healthNotes: 'Go easy on feta.' },
            ],
            notes: 'Two vegetarian low-sodium options.',
          },
        ]),
      ],
      analyses,
    );
    const { agent, yt } = await agentWith(llm);
    const res = await agent.run({ ...profile } as any);

    expect(res.agent).toMatchObject({ fallbackUsed: false, steps: 4, searches: 1, analyses: 3, agentNotes: 'Two vegetarian low-sodium options.' });
    expect(res.recommendations.map((r) => r.videoId)).toEqual([SOUP, SALAD]);
    expect(res.recommendations[0].whyItFits).toMatch(/lentil soup/);
    expect(res.recommendations[0].allergySafety.status).toBe('safe');
    expect(res.recommendations[1].healthNotes).toMatch(/Go easy on feta.*not medical advice/);
    expect(res.excluded.map((e) => e.videoId)).toEqual([SATAY]);
    expect(res.excluded[0].reason).toMatch(/^Blocked: .*peanut/);
    expect(yt.searches).toEqual(['low sodium vegetarian dinner']);
    expect(res.trace?.map((t) => t.tool)).toEqual([
      'list_known_videos',
      'search_videos',
      'analyze_video',
      'analyze_video',
      'analyze_video',
      'submit_plan',
    ]);
    expect(res.meta).toMatchObject({ mode: 'live', provider: 'gemini' });

    // History is resent verbatim each turn (store=false): thought + calls + results with matching ids.
    const last = llm.requests[3].input as any[];
    expect(last[0].type).toBe('user_input');
    expect(last.some((s) => s.type === 'thought')).toBe(true);
    const calls = last.filter((s) => s.type === 'function_call').map((s) => s.id);
    const results = last.filter((s) => s.type === 'function_result').map((s) => s.call_id);
    expect(results).toEqual(calls);
    expect(llm.requests[0].tools?.map((t) => t.name).sort()).toEqual(['analyze_video', 'list_known_videos', 'search_videos', 'submit_plan']);
  });

  it('rejects an unsafe or unanalyzed recommendation and accepts the corrected plan', async () => {
    const llm = new ScriptedLlmClient(
      [
        callTurn(['analyze_video', { videoId: SATAY }], ['analyze_video', { videoId: SOUP }]),
        callTurn([
          'submit_plan',
          {
            recommendations: [
              { videoId: SATAY, whyItFits: 'High protein satay, great for muscle building.' },
              { videoId: SALAD, whyItFits: 'Never analyzed but sounds nice and healthy.' },
            ],
          },
        ]),
        (req) => {
          const lastResult = (req.input as any[]).filter((s) => s.type === 'function_result').pop();
          const payload = JSON.parse(lastResult.result[0].text);
          expect(payload.accepted).toBe(false);
          expect(payload.errors.join(' ')).toMatch(new RegExp(`${SATAY}: allergySafety is unsafe`));
          expect(payload.errors.join(' ')).toMatch(new RegExp(`${SALAD}: not analyzed`));
          return callTurn(['submit_plan', { recommendations: [{ videoId: SOUP, whyItFits: 'Low sodium vegan soup that fits your profile.' }] }]);
        },
      ],
      analyses,
    );
    const { agent } = await agentWith(llm);
    const res = await agent.run({ ...profile } as any);
    expect(res.agent.fallbackUsed).toBe(false);
    expect(res.recommendations.map((r) => r.videoId)).toEqual([SOUP]);
    expect(res.recommendations.every((r) => r.allergySafety.status === 'safe')).toBe(true);
  });

  it('enforces budgets: forces submit_plan on the final step, then falls back deterministically', async () => {
    process.env.AGENT_MAX_STEPS = '3';
    process.env.AGENT_MAX_SEARCHES = '1';
    const llm = new ScriptedLlmClient(
      [
        callTurn(['search_videos', { query: 'vegetarian soup' }], ['analyze_video', { videoId: SOUP }]),
        callTurn(['search_videos', { query: 'another search' }]),
        callTurn(['search_videos', { query: 'one more' }]), // ignores the forced tool choice
      ],
      analyses,
    );
    const { agent, yt } = await agentWith(llm);
    const res = await agent.run({ ...profile } as any);

    expect(yt.searches).toEqual(['vegetarian soup']); // second search refused by budget
    const secondResults = (llm.requests[2].input as any[]).filter((s) => s.type === 'function_result');
    expect(JSON.stringify(secondResults)).toMatch(/search_budget_exhausted/);
    expect(llm.requests[2].toolChoice).toEqual({ mode: 'any', allowedTools: ['submit_plan'] });
    expect(JSON.stringify(llm.requests[2].input)).toMatch(/Call submit_plan now/);
    expect(res.agent).toMatchObject({ fallbackUsed: true, fallbackReason: 'step_budget_exhausted', steps: 3 });
    expect(res.recommendations.map((r) => r.videoId)).toEqual([SOUP]);
  });

  it('returns tool errors for invalid arguments so the model can recover', async () => {
    const llm = new ScriptedLlmClient(
      [
        callTurn(['analyze_video', { videoId: 'not-a-valid-id' }]),
        callTurn(['analyze_video', { videoId: SOUP }]),
        callTurn(['submit_plan', { recommendations: [{ videoId: SOUP, whyItFits: 'Low sodium soup that fits vegetarians.' }] }]),
      ],
      analyses,
    );
    const { agent } = await agentWith(llm);
    const res = await agent.run({ ...profile } as any);
    const firstResult = (llm.requests[1].input as any[]).find((s) => s.type === 'function_result');
    expect(firstResult.is_error).toBe(true);
    expect(firstResult.result[0].text).toMatch(/invalid_arguments/);
    expect(res.agent.fallbackUsed).toBe(false);
    expect(res.trace?.[0]).toMatchObject({ tool: 'analyze_video', ok: false });
  });

  it('nudges once when the model answers in text, then falls back', async () => {
    const llm = new ScriptedLlmClient([textTurn('Here are some ideas...'), textTurn('Still chatting')], analyses);
    const { agent } = await agentWith(llm);
    const res = await agent.run({ ...profile, videoCandidates: [{ idOrUrl: SOUP }] } as any);
    expect(JSON.stringify(llm.requests[1].input)).toMatch(/Call submit_plan now/);
    expect(res.agent).toMatchObject({ fallbackUsed: true, fallbackReason: 'model_stopped_without_plan' });
    // Fallback analyzed the user-supplied candidate deterministically.
    expect(res.recommendations.map((r) => r.videoId)).toEqual([SOUP]);
  });

  it('falls back when Gemini fails, keeping already-analyzed safe videos', async () => {
    const llm = new ScriptedLlmClient(
      [callTurn(['analyze_video', { videoId: SALAD }]), new LlmError('rate_limited', '429', 429, true)],
      analyses,
    );
    const { agent } = await agentWith(llm);
    const res = await agent.run({ ...profile } as any);
    expect(res.agent).toMatchObject({ fallbackUsed: true, fallbackReason: 'llm_error:rate_limited' });
    expect(res.recommendations.map((r) => r.videoId)).toEqual([SALAD]);
  });

  it('hides search_videos when YouTube is not configured', async () => {
    const llm = new ScriptedLlmClient(
      [callTurn(['submit_plan', { recommendations: [] }])],
      analyses,
    );
    const { agent } = await agentWith(llm, new FakeYouTube([], false));
    const res = await agent.run({ ...profile } as any);
    expect(llm.requests[0].tools?.map((t) => t.name)).not.toContain('search_videos');
    expect(llm.requests[0].systemInstruction).toMatch(/search is not available/);
    expect(res.recommendations).toEqual([]);
    expect(res.agent.fallbackUsed).toBe(false);
  });

  it('mock mode: no LLM calls, deterministic plan from the seed list', async () => {
    process.env.MEALPILOT_LLM_MODE = 'mock';
    const llm = new ScriptedLlmClient([]);
    const { agent } = await agentWith(llm, new FakeYouTube([], false));
    const res = await agent.run({ restrictions: ['vegan'], maxResults: 2 } as any);
    expect(llm.requests).toHaveLength(0);
    expect(res.agent).toMatchObject({ fallbackUsed: true, fallbackReason: 'llm_mock_mode' });
    expect(res.meta.provider).toBe('mock');
    expect(res.recommendations.length).toBeGreaterThan(0);
  });
});
