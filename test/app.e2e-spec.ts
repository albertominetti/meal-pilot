import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, RequestMethod, ValidationPipe } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('MealPilot API (e2e, offline)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    delete process.env.GEMINI_API_KEY;
    process.env.MEALPILOT_LLM_MODE = 'mock';
    process.env.MEALPILOT_CACHE_DIR = fs.mkdtempSync(
      path.join(os.tmpdir(), 'mealpilot-e2e-'),
    );
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api', {
      exclude: [{ path: '/', method: RequestMethod.GET }],
    });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET / redirects to the Swagger UI', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(302)
      .expect('Location', '/api/docs');
  });

  it('GET /api/health returns status, mode, and model', () => {
    return request(app.getHttpServer())
      .get('/api/health')
      .expect(200)
      .expect((res) => {
        expect(res.body.status).toBe('ok');
        expect(res.body.service).toBe('meal-pilot');
        expect(res.body.mode).toBe('mock');
        expect(res.body.model).toBe('gemini-3.8-flash');
      });
  });

  it('POST /api/meal-plan blocks peanut videos and returns meta', () => {
    return request(app.getHttpServer())
      .post('/api/meal-plan')
      .send({
        healthProfile: 'hypertension, type 2 diabetes',
        bloodPressure: '140/90',
        restrictions: ['vegetarian', 'gluten-free'],
        allergies: ['peanuts', 'shellfish'],
        preferences: 'low sodium, quick dinners',
        minResults: 1,
        maxResults: 5,
      })
      .expect(201)
      .expect((res) => {
        if (!res.body.disclaimer) throw new Error('missing disclaimer');
        if (!Array.isArray(res.body.recommendations))
          throw new Error('missing recommendations');
        if (!Array.isArray(res.body.excluded)) throw new Error('missing excluded');
        expect(res.body.recommendations.length).toBeGreaterThanOrEqual(1);
        expect(res.body.meta).toBeDefined();
        expect(res.body.meta.mode).toBe('mock');
        expect(res.body.meta.provider).toBe('mock');
        for (const r of res.body.recommendations) {
          expect(Array.isArray(r.labelCheck)).toBe(true);
          expect(r.recipe.ingredients.length).toBeGreaterThan(0);
          expect(r.recipe.ingredients[0]).toHaveProperty('rawText');
          expect(Array.isArray(r.recipe.steps)).toBe(true);
          expect(r.evidence.allergens).toBe(r.allergySafety.notes);
          expect(typeof r.trustedChannel).toBe('boolean');
        }
      });
  });

  it('POST /api/meal-plan/agent runs agentic loop in mock mode', () => {
    return request(app.getHttpServer())
      .post('/api/meal-plan/agent')
      .send({
        healthProfile: 'hypertension',
        restrictions: ['vegetarian'],
        allergies: ['peanuts'],
        maxResults: 2,
      })
      .expect(201)
      .expect((res) => {
        expect(res.body.disclaimer).toBeDefined();
        expect(Array.isArray(res.body.recommendations)).toBe(true);
        expect(Array.isArray(res.body.excluded)).toBe(true);
        expect(res.body.meta).toBeDefined();
        expect(res.body.meta.mode).toBe('mock');
      });
  });

  it('POST /api/meal-plan validates profile fields', async () => {
    await request(app.getHttpServer())
      .post('/api/meal-plan')
      .send({ maxCookMinutes: 2 })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/meal-plan')
      .send({ healthGoals: ['eat-more-cake'] })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/meal-plan')
      .send({ budget: 'free' })
      .expect(400);
  });

  it('POST /api/meal-plan applies the cooking-time limit', () => {
    return request(app.getHttpServer())
      .post('/api/meal-plan')
      .send({ maxCookMinutes: 25, householdSize: 2, budget: 'low', healthGoals: ['high-protein'] })
      .expect(201)
      .expect((res) => {
        const codes = res.body.excluded.map((e: { code: string }) => e.code);
        expect(codes).toContain('too_long');
      });
  });

  it('POST /api/shopping-list builds a list from cached analyses', async () => {
    // The meal-plan tests above analysed and cached the seed videos.
    const res = await request(app.getHttpServer())
      .post('/api/shopping-list')
      .send({ items: [{ videoId: 'jfKL8pQjBCA' }, { videoId: 'mPaJFxzwi-U' }], householdSize: 2 })
      .expect(200);
    const names = res.body.sections.flatMap((s: any) => s.items.map((i: any) => i.name));
    expect(names).toEqual(expect.arrayContaining(['red lentil', 'quinoa', 'chickpea']));
    expect(res.body.pantry.map((i: any) => i.name)).toContain('olive oil');
    expect(res.body.householdSize).toBe(2);
  });

  it('POST /api/shopping-list validates input', async () => {
    await request(app.getHttpServer()).post('/api/shopping-list').send({ items: [] }).expect(400);
    await request(app.getHttpServer())
      .post('/api/shopping-list')
      .send({ items: [{ videoId: 'x', servings: 0 }] })
      .expect(400);
  });

  it('POST /api/meal-plan includes a shopping list for the recommendations', () => {
    return request(app.getHttpServer())
      .post('/api/meal-plan')
      .send({ householdSize: 3, maxResults: 2 })
      .expect(201)
      .expect((res) => {
        expect(res.body.shoppingList.householdSize).toBe(3);
        const recipeIds = new Set(res.body.recommendations.map((r: any) => r.videoId));
        for (const section of res.body.shoppingList.sections) {
          for (const item of section.items) {
            for (const id of item.fromRecipes) expect(recipeIds.has(id)).toBe(true);
          }
        }
      });
  });

  it('GET /api/videos/cache lists entries', () => {
    return request(app.getHttpServer())
      .get('/api/videos/cache')
      .expect(200)
      .expect((res) => {
        if (typeof res.body.count !== 'number') throw new Error('missing count');
      });
  });
});
