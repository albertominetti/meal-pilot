import { INestApplication, RequestMethod, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { resetDatabase } from './helpers';

async function startApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api', { exclude: [{ path: '/', method: RequestMethod.GET }] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  return app;
}

describe('MealPilot API on Postgres', () => {
  // test/setup-db.ts points DATABASE_URL and DATABASE_URL_DIRECT at the test database.
  beforeAll(resetDatabase);

  it('keeps analyses across a restart and reports db: up', async () => {
    const first = await startApp();
    try {
      await request(first.getHttpServer())
        .post('/api/meal-plan')
        .send({ restrictions: ['vegetarian'], maxResults: 2 })
        .expect(201);
      const health = await request(first.getHttpServer()).get('/api/health').expect(200);
      expect(health.body).toMatchObject({ status: 'ok', db: 'up' });
    } finally {
      await first.close();
    }

    const second = await startApp();
    try {
      const res = await request(second.getHttpServer()).get('/api/videos/cache').expect(200);
      expect(res.body.count).toBeGreaterThan(0);
    } finally {
      await second.close();
    }
  });
});
