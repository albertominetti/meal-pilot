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
    process.env.MEALPILOT_CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mealpilot-e2e-'));
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

  it('GET /api/health', () => {
    return request(app.getHttpServer())
      .get('/api/health')
      .expect(200)
      .expect({ status: 'ok', service: 'meal-pilot' });
  });

  it('POST /api/meal-plan blocks peanut videos', () => {
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
        if (!res.body.disclaimer) throw new Error('missing disclaimer');
        if (!Array.isArray(res.body.recommendations)) throw new Error('missing recommendations');
        if (!Array.isArray(res.body.excluded)) throw new Error('missing excluded');
        if (res.body.excluded.length < 1) throw new Error('expected peanut video to be excluded');
      });
  });

  it('GET /api/videos/cache lists entries', () => {
    return request(app.getHttpServer()).get('/api/videos/cache').expect(200).expect((res) => {
      if (typeof res.body.count !== 'number') throw new Error('missing count');
    });
  });
});
