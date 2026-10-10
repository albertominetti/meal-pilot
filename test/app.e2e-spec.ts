import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, RequestMethod, ValidationPipe } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { LLM_CLIENT } from '../src/llm/llm-client';
import { YouTubeClient } from '../src/youtube/youtube.service';
import { FakeYouTube, ScriptedLlmClient, callTurn, okAnalysisJson, ytVideo } from './fakes';

async function createApp(overrides: { llm?: ScriptedLlmClient; youtube?: FakeYouTube } = {}) {
  process.env.MEALPILOT_CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mealpilot-e2e-'));
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (overrides.llm) builder = builder.overrideProvider(LLM_CLIENT).useValue(overrides.llm);
  builder = builder.overrideProvider(YouTubeClient).useValue(overrides.youtube ?? new FakeYouTube([], false));
  const moduleFixture: TestingModule = await builder.compile();
  const app = moduleFixture.createNestApplication();
  app.setGlobalPrefix('api', { exclude: [{ path: '/', method: RequestMethod.GET }] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  return app;
}

describe('MealPilot API (e2e, offline mock mode)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.MEALPILOT_LLM_MODE = 'mock';
    delete process.env.GEMINI_API_KEY;
    app = await createApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET / redirects to the Swagger UI', () => {
    return request(app.getHttpServer()).get('/').expect(302).expect('Location', '/api/docs');
  });

  it('GET /api/health reports mock mode without secrets', () => {
    return request(app.getHttpServer())
      .get('/api/health')
      .expect(200)
      .expect((res) => {
        expect(res.body).toMatchObject({ status: 'ok', service: 'meal-pilot', llm: { mode: 'mock', model: 'mock' } });
      });
  });

  it('POST /api/meal-plan blocks peanut videos and reports meta', () => {
    return request(app.getHttpServer())
      .post('/api/meal-plan')
      .send({
        healthProfile: 'hypertension, type 2 diabetes',
        bloodPressure: '140/90',
        restrictions: ['vegetarian', 'gluten-free'],
        allergies: ['peanuts', 'shellfish'],
        preferences: 'low sodium, quick dinners',
        videoCandidates: [
          { idOrUrl: 'dQw4w9WgXcQ', title: 'Peanut Satay Noodles', channel: 'Wok House' },
          { idOrUrl: 'abcdefghijk', title: 'Low-Sodium Vegetarian Lentil Soup', channel: 'Healthy Kitchen' },
        ],
        maxResults: 5,
      })
      .expect(201)
      .expect((res) => {
        expect(res.body.disclaimer).toBeTruthy();
        expect(Array.isArray(res.body.recommendations)).toBe(true);
        const blocked = res.body.excluded.find((e: any) => e.videoId === 'dQw4w9WgXcQ');
        expect(blocked.reason).toMatch(/^Blocked/);
        expect(res.body.meta).toMatchObject({ mode: 'mock', provider: 'mock', analyzed: 2 });
      });
  });

  it('POST /api/meal-plan/agent falls back to the deterministic planner in mock mode', () => {
    return request(app.getHttpServer())
      .post('/api/meal-plan/agent')
      .send({ restrictions: ['vegan'], maxResults: 2 })
      .expect(200)
      .expect((res) => {
        expect(res.body.agent).toMatchObject({ fallbackUsed: true, fallbackReason: 'llm_mock_mode' });
        expect(res.body.recommendations.length).toBeGreaterThan(0);
        expect(res.body.trace).toBeUndefined();
      });
  });

  it('POST /api/meal-plan/agent validates input', () => {
    return request(app.getHttpServer()).post('/api/meal-plan/agent').send({ maxResults: 99 }).expect(400);
  });

  it('GET /api/videos/cache lists entries', () => {
    return request(app.getHttpServer())
      .get('/api/videos/cache')
      .expect(200)
      .expect((res) => {
        expect(typeof res.body.count).toBe('number');
      });
  });
});

describe('MealPilot API (e2e, live mode with fake Gemini + YouTube)', () => {
  let app: INestApplication;
  const saved = { ...process.env };

  afterAll(async () => {
    await app?.close();
    process.env = { ...saved };
  });

  it('POST /api/meal-plan/agent runs the tool loop end-to-end', async () => {
    process.env.MEALPILOT_LLM_MODE = 'live';
    process.env.GEMINI_API_KEY = 'test';
    const llm = new ScriptedLlmClient(
      [
        callTurn(['search_videos', { query: 'vegan soup' }]),
        callTurn(['analyze_video', { videoId: 'soupsoup001' }]),
        callTurn(['submit_plan', { recommendations: [{ videoId: 'soupsoup001', whyItFits: 'A vegan, low-sodium lentil soup for your goals.' }] }]),
      ],
      () => okAnalysisJson(),
    );
    app = await createApp({ llm, youtube: new FakeYouTube([ytVideo('soupsoup001', 'Lentil Soup')]) });
    const res = await request(app.getHttpServer())
      .post('/api/meal-plan/agent')
      .send({ restrictions: ['vegan'], allergies: ['peanuts'], maxResults: 1, debug: true })
      .expect(200);
    expect(res.body.agent).toMatchObject({ fallbackUsed: false, searches: 1, analyses: 1 });
    expect(res.body.recommendations[0]).toMatchObject({ videoId: 'soupsoup001', provider: 'gemini' });
    expect(res.body.trace.map((t: any) => t.tool)).toEqual(['search_videos', 'analyze_video', 'submit_plan']);
  });
});
