import { NotFoundException } from '@nestjs/common';
import { FileUserDataStore } from './user-data.store';
import { ProfilesService } from './profiles.service';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('ProfilesService', () => {
  let svc: ProfilesService;

  beforeEach(() => {
    process.env.MEALPILOT_CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mealpilot-users-'));
    svc = new ProfilesService(new FileUserDataStore());
  });

  it('stores only profile fields with the time of consent', async () => {
    const stored = await svc.put({ consent: true, allergies: ['peanuts'], householdSize: 2, extra: 'x' } as any);
    expect(stored.profile).toEqual({ allergies: ['peanuts'], householdSize: 2 });
    expect(stored.consentAt).toBeTruthy();
  });

  it('merges inline fields over the stored profile but never drops a stored allergy', async () => {
    await svc.put({ consent: true, allergies: ['peanuts'], maxCookMinutes: 30, restrictions: ['vegan'] });
    const { request } = await svc.resolve({ allergies: [], maxCookMinutes: 45 });
    expect(request).toMatchObject({ allergies: ['peanuts'], maxCookMinutes: 45, restrictions: ['vegan'] });

    const more = await svc.resolve({ allergies: ['Sesame', 'PEANUTS'] });
    expect(more.request.allergies).toEqual(['peanuts', 'Sesame']);
  });

  it('uses the inline fields alone when no profile is stored', async () => {
    expect((await svc.resolve({ allergies: ['celery'] })).request).toEqual({ allergies: ['celery'] });
    await expect(svc.get()).rejects.toThrow(NotFoundException);
  });

  it('returns feedback from the meal log and erases everything on delete', async () => {
    await svc.put({ consent: true });
    await svc.addMeal({ videoId: 'v1', cooked: true, rating: 1 });
    expect((await svc.resolve({})).feedback.get('v1')).toEqual({ userRating: 1, cookedCount: 1 });

    expect(await svc.delete()).toEqual({ profiles: 1, plans: 0, meals: 1 });
    await expect(svc.get()).rejects.toThrow(NotFoundException);
    expect(await svc.listMeals()).toEqual([]);
  });
});
