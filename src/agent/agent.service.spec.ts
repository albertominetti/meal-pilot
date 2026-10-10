import { Test } from '@nestjs/testing';
import { AgentService } from './agent.service';
import { LLM_CLIENT, LlmClient, InteractionRequest, InteractionResult } from '../llm/llm-client.interface';
import { AppConfigService } from '../config/app-config.service';
import { ListKnownVideosTool } from './tools/list-known-videos.tool';
import { SearchVideosTool } from './tools/search-videos.tool';
import { AnalyzeVideoTool } from './tools/analyze-video.tool';
import { CheckProfileFitTool } from './tools/check-profile-fit.tool';
import { SubmitPlanTool } from './tools/submit-plan.tool';
import { FallbackPlanner } from './fallback-planner';
import { TranscriptCacheService } from '../videos/transcript-cache.service';
import { VideoAnalysisService } from '../videos/video-analysis.service';
import { MealPlanService } from '../meal-plan/meal-plan.service';
import { FakeYouTubeService } from '../youtube/fake-youtube.service';
import { YOUTUBE_SERVICE } from '../youtube/youtube.interface';
import { VIDEO_ANALYZER } from '../videos/analyzers/video-analyzer.interface';
import { MockVideoAnalyzer } from '../videos/analyzers/mock-video-analyzer';

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

  beforeEach(async () => {
    scriptedLlm = new ScriptedLlmClient();
    const mockConfig = {
      agentMaxSteps: 5,
      agentMaxAnalyses: 5,
      agentMaxSearches: 3,
      agentTimeoutMs: 10000,
      geminiModel: 'gemini-3.8-flash',
      effectiveLlmMode: 'mock' as const,
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AgentService,
        ListKnownVideosTool,
        SearchVideosTool,
        AnalyzeVideoTool,
        CheckProfileFitTool,
        SubmitPlanTool,
        FallbackPlanner,
        TranscriptCacheService,
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
});
