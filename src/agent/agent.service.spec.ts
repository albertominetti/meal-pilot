import { Test } from '@nestjs/testing';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AgentService } from './agent.service';
import { LLM_CLIENT, LlmClient, InteractionRequest, InteractionResult } from '../llm/llm-client.interface';
import { AppConfigService } from '../config/app-config.service';
import { ListKnownVideosTool } from './tools/list-known-videos.tool';
import { SearchVideosTool } from './tools/search-videos.tool';
import { AnalyzeVideoTool } from './tools/analyze-video.tool';
import { CheckProfileFitTool } from './tools/check-profile-fit.tool';
import { CheckPlanBalanceTool } from './tools/check-plan-balance.tool';
import { RunDigestService } from './run-digest.service';
import { SubmitPlanTool } from './tools/submit-plan.tool';
import { FallbackPlanner } from './fallback-planner';
import { ANALYSIS_STORE } from '../videos/analysis-store';
import { FileAnalysisStore } from '../videos/file-analysis.store';
import { VideoAnalysisService } from '../videos/video-analysis.service';
import { MealPlanService } from '../meal-plan/meal-plan.service';
import { FakeYouTubeService } from '../youtube/fake-youtube.service';
import { YOUTUBE_SERVICE } from '../youtube/youtube.interface';
import { VIDEO_ANALYZER } from '../videos/analyzers/video-analyzer.interface';
import { MockVideoAnalyzer } from '../videos/analyzers/mock-video-analyzer';
import { TrustedChannelsService } from '../youtube/trusted-channels.service';

class ScriptedLlmClient implements LlmClient {
  public cannedResponses: InteractionResult[] = [];
  public callHistory: InteractionRequest[] = [];

  async createInteraction(req: InteractionRequest): Promise<InteractionResult> {
    this.callHistory.push(req);
    if (this.cannedResponses.length > 0) {
      return this.cannedResponses.shift()!;
    }
    // Fallback response with no tool calls to break the loop
    return {
      outputText: 'Done',
      steps: [
        {
          type: 'model_output',
          content: [{ type: 'text', text: 'No further action' }],
        },
      ],
    };
  }
}

describe('AgentService (tool loop and guardrails)', () => {
  let agentService: AgentService;
  let scriptedLlm: ScriptedLlmClient;
  let fakeYouTube: FakeYouTubeService;

  const call = (id: string, name: string, args: Record<string, unknown>) => ({
    type: 'function_call' as const,
    id,
    name,
    arguments: args,
  });

  /** Parsed function results the model received on its N-th turn (0-based). */
  const resultsSeenOnTurn = (turn: number, name: string): any[] =>
    (scriptedLlm.callHistory[turn].input as any[])
      .filter((s) => s.type === 'function_result' && s.name === name)
      .map((s) => JSON.parse(s.result));

  beforeEach(async () => {
    // Each test gets its own cache so nothing leaks between tests or into data/cache.
    process.env.MEALPILOT_CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mealpilot-agent-'));
    scriptedLlm = new ScriptedLlmClient();
    const mockConfig = {
      agentMaxSteps: 5,
      agentMaxAnalyses: 5,
      agentMaxSearches: 3,
      agentTimeoutMs: 10000,
      geminiModel: 'gemini-3.8-flash',
      effectiveLlmMode: 'mock' as const,
      trustedChannelsFile: 'test/fixtures/trusted-channels.json',
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AgentService,
        ListKnownVideosTool,
        SearchVideosTool,
        AnalyzeVideoTool,
        CheckProfileFitTool,
        CheckPlanBalanceTool,
        SubmitPlanTool,
        FallbackPlanner,
        RunDigestService,
        TrustedChannelsService,
        { provide: ANALYSIS_STORE, useClass: FileAnalysisStore },
        VideoAnalysisService,
        MealPlanService,
        MockVideoAnalyzer,
        {
          provide: VIDEO_ANALYZER,
          useClass: MockVideoAnalyzer,
        },
        {
          provide: LLM_CLIENT,
          useValue: scriptedLlm,
        },
        {
          provide: AppConfigService,
          useValue: mockConfig,
        },
        {
          provide: YOUTUBE_SERVICE,
          useClass: FakeYouTubeService,
        },
      ],
    }).compile();

    agentService = moduleRef.get(AgentService);
    fakeYouTube = moduleRef.get(YOUTUBE_SERVICE);
  });

  it('runs tool loop: search -> analyze -> submit plan successfully', async () => {
    // Turn 1: Model calls search_videos
    scriptedLlm.cannedResponses.push({
      outputText: '',
      steps: [
        {
          type: 'function_call',
          id: 'call_1',
          name: 'search_videos',
          arguments: { query: 'lentil soup', maxResults: 1 },
        },
      ],
    });

    // Turn 2: Model calls analyze_video
    scriptedLlm.cannedResponses.push({
      outputText: '',
      steps: [
        {
          type: 'function_call',
          id: 'call_2',
          name: 'analyze_video',
          arguments: {
            videoId: 'jfKL8pQjBCA',
            title: 'Amazing Red Lentil Soup',
          },
        },
      ],
    });

    // Turn 3: Model calls submit_plan
    scriptedLlm.cannedResponses.push({
      outputText: '',
      steps: [
        {
          type: 'function_call',
          id: 'call_3',
          name: 'submit_plan',
          arguments: {
            recommendations: [
              {
                videoId: 'jfKL8pQjBCA',
                whyItFits: 'High fiber, low sodium lentil soup ideal for blood pressure management.',
              },
            ],
            notes: 'Enjoy with a side salad.',
          },
        },
      ],
    });

    const res = await agentService.run(
      {
        healthProfile: 'hypertension',
        restrictions: ['vegetarian'],
        allergies: ['peanuts'],
        maxResults: 1,
      },
      true, // debug
    );

    expect(res.recommendations.length).toBe(1);
    expect(res.recommendations[0].videoId).toBe('jfKL8pQjBCA');
    expect(res.recommendations[0].allergySafety.status).toBe('safe');
    expect(res.meta.fallbackUsed).toBe(false);
    expect(res.trace).toBeDefined();
    expect(res.trace?.length).toBe(3);
  });

  it('activates fallback planner when model exhausts steps without submit_plan', async () => {
    // Turn 1: Model calls analyze_video
    scriptedLlm.cannedResponses.push({
      outputText: '',
      steps: [
        {
          type: 'function_call',
          id: 'call_1',
          name: 'analyze_video',
          arguments: {
            videoId: 'mPaJFxzwi-U',
            title: 'Vegan Quinoa Buddha Bowl',
          },
        },
      ],
    });

    // Turn 2: Model returns plain text without calling submit_plan
    scriptedLlm.cannedResponses.push({
      outputText: 'Here is your plan in plain text.',
      steps: [
        {
          type: 'model_output',
          content: [{ type: 'text', text: 'I am done.' }],
        },
      ],
    });

    const res = await agentService.run({
      healthProfile: 'general health',
      restrictions: ['vegan'],
      allergies: [],
      maxResults: 2,
    });

    expect(res.meta.fallbackUsed).toBe(true);
    expect(res.recommendations.length).toBe(1);
    expect(res.recommendations[0].videoId).toBe('mPaJFxzwi-U');
  });

  it('rejects unsafe videos in submit_plan guardrail', async () => {
    const submitTool = new SubmitPlanTool();
    const run: any = {
      request: { maxResults: 5, allergies: ['peanuts'] },
      analyzedVideos: new Map([
        ['ZtK81MzVoJ4', { videoId: 'ZtK81MzVoJ4', title: 'Peanut Satay' }],
      ]),
      videoSafetyVerdicts: new Map([
        [
          'ZtK81MzVoJ4',
          {
            status: 'unsafe',
            notes: 'Contains peanuts',
          },
        ],
      ]),
    };

    const result: any = await submitTool.execute(
      {
        recommendations: [
          { videoId: 'ZtK81MzVoJ4', whyItFits: 'A tasty noodle dish' },
        ],
      },
      run,
    );

    expect(result.accepted).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatch(/is not safe/);
  });

  it('rejects a recipe over the cooking-time limit in submit_plan (too_long)', async () => {
    const submitTool = new SubmitPlanTool();
    const run: any = {
      request: { maxResults: 5, maxCookMinutes: 20 },
      analyzedVideos: new Map([['slow-stew', { videoId: 'slow-stew', prepMinutes: 90 }]]),
      videoSafetyVerdicts: new Map([['slow-stew', { status: 'safe', notes: 'ok' }]]),
    };
    const result: any = await submitTool.execute(
      { recommendations: [{ videoId: 'slow-stew', whyItFits: 'Hearty stew' }] },
      run,
    );
    expect(result.accepted).toBe(false);
    expect(result.errors[0]).toMatch(/too_long/);
  });

  it('allows a recipe with unknown prep time under a time limit', async () => {
    const submitTool = new SubmitPlanTool();
    const run: any = {
      request: { maxResults: 5, maxCookMinutes: 20 },
      analyzedVideos: new Map([['mystery', { videoId: 'mystery' }]]),
      videoSafetyVerdicts: new Map([['mystery', { status: 'safe', notes: 'ok' }]]),
    };
    const result: any = await submitTool.execute(
      { recommendations: [{ videoId: 'mystery', whyItFits: 'Unknown timing' }] },
      run,
    );
    expect(result.accepted).toBe(true);
  });

  it('marks trusted channels in search results and lists them first', async () => {
    scriptedLlm.cannedResponses.push({
      outputText: '',
      steps: [
        {
          type: 'function_call',
          id: 'call_1',
          name: 'search_videos',
          arguments: { query: 'vegan lentil quinoa', maxResults: 5 },
        },
      ],
    });
    const res = await agentService.run({ restrictions: ['vegan'], maxResults: 1 }, true);
    const searchResult = (scriptedLlm.callHistory[1].input as any[]).find(
      (s: any) => s.type === 'function_result' && s.name === 'search_videos',
    ) as any;
    const videos = JSON.parse(searchResult.result).videos;
    expect(videos[0]).toMatchObject({ videoId: 'mPaJFxzwi-U', trustedChannel: true });
    expect(videos.slice(1).every((v: any) => v.trustedChannel === false)).toBe(true);
    expect(res.meta.searches).toBe(1);
  });

  it('uses content digests and check_plan_balance to swap a repeated protein', async () => {
    for (const [id, title] of [
      ['chk-1', 'Chickpea Curry'],
      ['chk-2', 'Chickpea Salad'],
      ['chk-3', 'Chickpea Stew'],
    ]) {
      fakeYouTube.addVideo({
        videoId: id,
        title,
        channel: 'Pulse Kitchen',
        channelId: 'UC_pulse',
        description: 'Serves 2. Ingredients: 400g chickpeas, 1 onion, 2 cloves garlic.',
        durationSec: 600,
        privacyStatus: 'public',
        embeddable: true,
      });
    }

    scriptedLlm.cannedResponses.push(
      {
        outputText: '',
        steps: [
          call('c1', 'analyze_video', { videoId: 'chk-1' }),
          call('c2', 'analyze_video', { videoId: 'chk-2' }),
          call('c3', 'analyze_video', { videoId: 'chk-3' }),
          call('c4', 'analyze_video', { videoId: 'jfKL8pQjBCA' }),
        ],
      },
      { outputText: '', steps: [call('c5', 'check_plan_balance', { videoIds: ['chk-1', 'chk-2', 'chk-3'] })] },
      {
        outputText: '',
        steps: [
          call('c6', 'submit_plan', {
            recommendations: [
              { videoId: 'chk-1', whyItFits: 'Chickpea curry, 400 g chickpeas' },
              { videoId: 'chk-2', whyItFits: 'Chickpea salad' },
              { videoId: 'jfKL8pQjBCA', whyItFits: 'Lentil soup swaps out the third chickpea dish' },
            ],
          }),
        ],
      },
    );

    const res = await agentService.run({ maxResults: 3 }, true);

    const digests = resultsSeenOnTurn(1, 'analyze_video');
    expect(digests.map((d) => d.mainProtein)).toEqual(['chickpea', 'chickpea', 'chickpea', 'lentil']);
    expect(digests[0].keyIngredients).toContain('chickpea 400 g');
    expect(Buffer.byteLength(JSON.stringify(digests[0]))).toBeLessThanOrEqual(1500);

    const [balance] = resultsSeenOnTurn(2, 'check_plan_balance');
    expect(balance.proteins).toEqual({ chickpea: 3 });
    expect(balance.warnings.join(' ')).toMatch(/3 recipes use chickpea/);

    expect(res.meta.fallbackUsed).toBe(false);
    expect(res.recommendations.map((r) => r.videoId)).toEqual(['chk-1', 'chk-2', 'jfKL8pQjBCA']);
    expect(res.trace?.map((t) => t.tool)).toContain('check_plan_balance');

    const curry = res.recommendations[0];
    expect(curry.recipe.ingredients.find((i) => i.name === 'chickpea')).toMatchObject({
      quantity: 400,
      unit: 'g',
      source: 'description',
    });
    expect(curry.recipe.servings).toBe(2);
    expect(curry.evidence.allergens).toBe(curry.allergySafety.notes);
    const chickpeaLine = res.shoppingList.sections
      .flatMap((sec) => sec.items)
      .find((i) => i.name === 'chickpea');
    expect(chickpeaLine?.fromRecipes).toEqual(['chk-1', 'chk-2']);
  });

  it('shows fitsTime: false in the digest and enforces it in submit_plan', async () => {
    scriptedLlm.cannedResponses.push(
      {
        outputText: '',
        steps: [
          call('c1', 'analyze_video', { videoId: 'jfKL8pQjBCA' }),
          call('c2', 'analyze_video', { videoId: 'tv6Wrr2-hRU' }),
        ],
      },
      {
        outputText: '',
        steps: [call('c3', 'submit_plan', { recommendations: [{ videoId: 'jfKL8pQjBCA', whyItFits: 'Lentil soup' }] })],
      },
      {
        outputText: '',
        steps: [call('c4', 'submit_plan', { recommendations: [{ videoId: 'tv6Wrr2-hRU', whyItFits: '15-minute stir fry' }] })],
      },
    );

    const res = await agentService.run({ maxCookMinutes: 20, maxResults: 1 });

    const digests = resultsSeenOnTurn(1, 'analyze_video');
    expect(digests.find((d) => d.videoId === 'jfKL8pQjBCA').fitsTime).toBe(false);
    expect(digests.find((d) => d.videoId === 'tv6Wrr2-hRU').fitsTime).toBe(true);

    const [rejection] = resultsSeenOnTurn(2, 'submit_plan');
    expect(rejection.accepted).toBe(false);
    expect(rejection.errors[0]).toMatch(/too_long/);

    expect(res.recommendations.map((r) => r.videoId)).toEqual(['tv6Wrr2-hRU']);
    expect(res.recommendations[0].fitsTime).toBe(true);
    expect(res.excluded.find((e) => e.videoId === 'jfKL8pQjBCA')?.code).toBe('too_long');
  });
});
