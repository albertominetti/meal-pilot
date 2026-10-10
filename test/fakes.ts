import { Test } from '@nestjs/testing';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AgentService } from '../src/agent/agent.service';
import { AppConfig } from '../src/config/app-config.service';
import { LLM_CLIENT } from '../src/llm/llm-client';
import { MealPlanService } from '../src/meal-plan/meal-plan.service';
import { GeminiVideoAnalyzer } from '../src/videos/analyzers/gemini-video-analyzer';
import { MockVideoAnalyzer } from '../src/videos/analyzers/mock-video-analyzer';
import { TranscriptCacheService } from '../src/videos/transcript-cache.service';
import { VideoAnalysisService } from '../src/videos/video-analysis.service';
import type { LlmClient, LlmRequest, LlmResponse, LlmStep } from '../src/llm/llm-client';
import { ANALYSIS_SCHEMA_VERSION, VideoAnalysis } from '../src/videos/analysis.schema';
import { YouTubeClient, YouTubeSearchOptions, YouTubeVideoDetails } from '../src/youtube/youtube.service';

/** Replays a scripted sequence of model turns; records every request. */
export class ScriptedLlmClient implements LlmClient {
  readonly requests: LlmRequest[] = [];
  readonly analysisRequests: LlmRequest[] = [];
  /**
   * @param turns scripted responses, consumed in order
   * @param analysisResponder if set, video-analysis calls (requests with a
   *   responseSchema) are answered by it instead of consuming `turns`.
   */
  constructor(
    private readonly turns: Array<LlmResponse | Error | ((req: LlmRequest) => LlmResponse)>,
    private readonly analysisResponder?: (videoUrl: string) => string | Error,
  ) {}

  async create(req: LlmRequest): Promise<LlmResponse> {
    if (this.analysisResponder && req.responseSchema) {
      this.analysisRequests.push(req);
      const video = (req.input as any[]).find((c) => c.type === 'video');
      const out = this.analysisResponder(video?.uri ?? '');
      if (out instanceof Error) throw out;
      return { steps: [], text: out, functionCalls: [] };
    }
    this.requests.push(JSON.parse(JSON.stringify(req)));
    const next = this.turns.shift();
    if (!next) throw new Error('ScriptedLlmClient: no more scripted turns');
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next(req) : next;
  }
}

let callSeq = 0;

/** A model turn that issues the given function calls. */
export function callTurn(...calls: Array<[name: string, args: Record<string, any>]>): LlmResponse {
  const steps: LlmStep[] = [{ type: 'thought', signature: 'sig' }];
  const functionCalls = calls.map(([name, args]) => {
    const id = `call_${++callSeq}`;
    steps.push({ type: 'function_call', id, name, arguments: args });
    return { id, name, arguments: args };
  });
  return { steps, text: '', functionCalls, usage: { inputTokens: 100, outputTokens: 20 } };
}

export function textTurn(text: string): LlmResponse {
  return {
    steps: [{ type: 'model_output', content: [{ type: 'text', text }] }],
    text,
    functionCalls: [],
    usage: { inputTokens: 50, outputTokens: 10 },
  };
}

export function okAnalysisJson(overrides: Record<string, any> = {}): string {
  return JSON.stringify({
    recipeName: 'Lentil Soup',
    servings: 4,
    ingredients: [{ name: 'red lentils' }, { name: 'carrot' }, { name: 'olive oil' }],
    steps: ['Simmer lentils with vegetables'],
    allergens: [],
    crossContactNotes: [],
    sodiumSources: [],
    nutritionSignals: ['low-sodium', 'high-fiber'],
    restrictionTags: ['vegan', 'vegetarian', 'gluten-free'],
    summary: 'A low-sodium vegan lentil soup.',
    coverage: 'full',
    ...overrides,
  });
}

export function makeAnalysis(videoId: string, overrides: Partial<VideoAnalysis> = {}): VideoAnalysis {
  return {
    videoId,
    title: `Video ${videoId}`,
    channel: 'Test Kitchen',
    status: 'ok',
    provider: 'gemini',
    model: 'gemini-3.8-flash',
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    analyzedAt: new Date().toISOString(),
    recipeName: `Recipe ${videoId}`,
    ingredients: [{ name: 'lentils' }],
    steps: ['cook'],
    allergens: [],
    crossContactNotes: [],
    sodiumSources: [],
    nutritionSignals: ['low-sodium'],
    restrictionTags: ['vegetarian'],
    summary: 'Simple vegetarian dish.',
    coverage: 'full',
    ...overrides,
  };
}

export class FakeYouTube extends YouTubeClient {
  searches: string[] = [];
  used = 0;
  constructor(
    private readonly videos: YouTubeVideoDetails[],
    private readonly enabled = true,
  ) {
    super();
  }
  isEnabled() {
    return this.enabled;
  }
  async search(query: string, opts?: YouTubeSearchOptions) {
    this.searches.push(query);
    this.used += 100;
    return this.videos.slice(0, opts?.maxResults ?? 8);
  }
  async getDetails(ids: string[]) {
    this.used += 1;
    return new Map(this.videos.filter((v) => ids.includes(v.videoId)).map((v) => [v.videoId, v]));
  }
  quota() {
    return { used: this.used, limit: 9000, day: 'test' };
  }
}

export function ytVideo(videoId: string, title: string, extra: Partial<YouTubeVideoDetails> = {}): YouTubeVideoDetails {
  return { videoId, title, channel: 'Chan', durationSec: 600, privacyStatus: 'public', embeddable: true, ...extra };
}


/** Nest testing module with fake LLM / YouTube and an isolated cache dir. */
export async function buildTestingModule(opts: { llm?: LlmClient; youtube?: YouTubeClient } = {}) {
  process.env.MEALPILOT_CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mealpilot-test-'));
  const providers: any[] = [
    AppConfig,
    MealPlanService,
    TranscriptCacheService,
    VideoAnalysisService,
    GeminiVideoAnalyzer,
    MockVideoAnalyzer,
    AgentService,
    { provide: LLM_CLIENT, useValue: opts.llm ?? new ScriptedLlmClient([]) },
  ];
  if (opts.youtube) providers.push({ provide: YouTubeClient, useValue: opts.youtube });
  return Test.createTestingModule({ providers }).compile();
}
