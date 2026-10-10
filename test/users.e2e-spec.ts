import { INestApplication, RequestMethod, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Profiles, saved plans, meal log and swap (e2e, offline)', () => {
  let app: INestApplication;
  const user = 'u-e2e_1';

  beforeAll(async () => {
    process.env.MEALPILOT_CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mealpilot-users-e2e-'));
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api', { exclude: [{ path: '/', method: RequestMethod.GET }] });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  it('runs the whole flow from consent to erasure', async () => {
    await http().put(`/api/users/${user}/profile`).send({ allergies: ['celery'] }).expect(400);
    await http().put('/api/users/bad%20id/profile').send({ consent: true }).expect(400);

    const profile = await http()
      .put(`/api/users/${user}/profile`)
      .send({ consent: true, allergies: ['celery'], householdSize: 2 })
      .expect(200);
    expect(profile.body.profile).toEqual({ allergies: ['celery'], householdSize: 2 });

    await http().post('/api/meal-plan').send({ userId: 'nobody', maxResults: 1 }).expect(404);

    // The stored profile is used: householdSize 2 scales the shopping list.
    const first = await http().post('/api/meal-plan').send({ userId: user, maxResults: 1 }).expect(201);
    expect(first.body.planId).toEqual(expect.any(String));
    expect(first.body.shoppingList.householdSize).toBe(2);
    const [chosen] = first.body.recommendations.map((r: { videoId: string }) => r.videoId);
    expect(chosen).toBeDefined();

    const plan = await http().get(`/api/plans/${first.body.planId}`).expect(200);
    expect(plan.body.recommendations[0].videoId).toBe(chosen);
    const keys: string[] = plan.body.shoppingList.sections.flatMap((s: any) => s.items.map((i: any) => i.key));

    const checked = await http()
      .patch(`/api/plans/${first.body.planId}/checked`)
      .send({ checked: [keys[0], 'not-an-item|g'] })
      .expect(200);
    expect(checked.body).toMatchObject({ version: 2, checked: [keys[0]] });

    await http().post(`/api/users/${user}/meals`).send({ videoId: chosen, cooked: true, rating: 1 }).expect(201);
    const meals = await http().get(`/api/users/${user}/meals`).expect(200);
    expect(meals.body).toHaveLength(1);

    // Rated 1: never recommended to this user again.
    const second = await http().post('/api/meal-plan').send({ userId: user, maxResults: 3 }).expect(201);
    expect(second.body.recommendations.map((r: any) => r.videoId)).not.toContain(chosen);
    expect(second.body.excluded).toContainEqual(expect.objectContaining({ videoId: chosen, code: 'rated_low' }));

    // Swap from the cache: no Gemini call, a new version, a rebuilt list.
    const swapped = await http()
      .post(`/api/plans/${first.body.planId}/swap`)
      .send({ videoId: chosen })
      .expect(200);
    expect(swapped.body.swapped).toMatchObject({ removed: chosen, via: 'cache' });
    expect(swapped.body.swapped.added).not.toBe(chosen);
    expect(swapped.body.version).toBe(3);
    expect(swapped.body.recommendations.map((r: any) => r.videoId)).toEqual([swapped.body.swapped.added]);
    const newKeys = new Set(swapped.body.shoppingList.sections.flatMap((s: any) => s.items.map((i: any) => i.key)));
    for (const k of swapped.body.checked) expect(newKeys.has(k)).toBe(true);

    await http().post(`/api/plans/${first.body.planId}/swap`).send({ videoId: 'not-in-plan' }).expect(400);

    const erased = await http().delete(`/api/users/${user}/profile`).expect(200);
    expect(erased.body).toEqual({ profiles: 1, plans: 2, meals: 1 });
    await http().get(`/api/plans/${first.body.planId}`).expect(404);
    await http().get(`/api/users/${user}/profile`).expect(404);
  });

  it('saves anonymous plans too', async () => {
    const res = await http().post('/api/meal-plan').send({ maxResults: 1 }).expect(201);
    await http().get(`/api/plans/${res.body.planId}`).expect(200);
    await http().get('/api/plans/not-a-uuid').expect(400);
  });
});
