import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { MealPlanRequestDto } from '../meal-plan/dto/meal-plan-request.dto';
import { FeedbackMap, feedbackFrom } from './feedback';
import { MealLogDto, ProfileDto } from './dto/user-data.dto';
import {
  DeletedUserData,
  MealLog,
  ProfileData,
  StoredProfile,
  USER_DATA_STORE,
  UserDataStore,
} from './user-data.store';

/** Fields a stored profile holds; inline request values override them one by one. */
const PROFILE_FIELDS = [
  'healthProfile',
  'bloodPressure',
  'restrictions',
  'allergies',
  'healthGoals',
  'householdSize',
  'maxCookMinutes',
  'budget',
  'preferences',
] as const satisfies ReadonlyArray<keyof ProfileData>;

export function pickProfile(source: Partial<ProfileData>): ProfileData {
  const out: Record<string, unknown> = {};
  for (const f of PROFILE_FIELDS) {
    if (source[f] !== undefined) out[f] = source[f];
  }
  return out as ProfileData;
}

export interface ResolvedRequest {
  request: MealPlanRequestDto;
  feedback: FeedbackMap;
}

@Injectable()
export class ProfilesService {
  constructor(@Inject(USER_DATA_STORE) private readonly store: UserDataStore) {}

  async get(userId: string): Promise<StoredProfile> {
    const profile = await this.store.getProfile(userId);
    if (!profile) throw new NotFoundException('No stored profile for this user');
    return profile;
  }

  async put(userId: string, dto: ProfileDto): Promise<StoredProfile> {
    const now = new Date().toISOString();
    const existing = await this.store.getProfile(userId);
    const stored: StoredProfile = {
      userId,
      profile: pickProfile(dto),
      consentAt: now,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await this.store.putProfile(stored);
    return stored;
  }

  delete(userId: string): Promise<DeletedUserData> {
    return this.store.deleteUser(userId);
  }

  /**
   * The profile a plan is built for: the stored one, with any field sent
   * inline taking precedence, except allergies, which are the union of both
   * (an inline empty list must never drop a stored allergy). An unknown
   * userId is an error rather than an empty profile for the same reason.
   */
  async resolve(dto: MealPlanRequestDto): Promise<ResolvedRequest> {
    if (!dto.userId) return { request: dto, feedback: new Map() };
    const stored = await this.get(dto.userId);
    const request: MealPlanRequestDto = { ...stored.profile, ...stripUndefined(dto) };
    request.allergies = mergeAllergies(stored.profile.allergies, dto.allergies);
    return { request, feedback: await this.feedback(dto.userId) };
  }

  async feedback(userId: string): Promise<FeedbackMap> {
    return feedbackFrom(await this.store.listMeals(userId));
  }

  async addMeal(userId: string, dto: MealLogDto): Promise<MealLog> {
    const log: MealLog = {
      id: randomUUID(),
      userId,
      videoId: dto.videoId,
      planId: dto.planId ?? null,
      cooked: dto.cooked,
      rating: dto.rating ?? null,
      note: dto.note ?? null,
      createdAt: new Date().toISOString(),
    };
    await this.store.addMeal(log);
    return log;
  }

  listMeals(userId: string): Promise<MealLog[]> {
    return this.store.listMeals(userId);
  }
}

export function mergeAllergies(...lists: Array<string[] | undefined>): string[] {
  const seen = new Map<string, string>();
  for (const a of lists.flat()) {
    const trimmed = a?.trim();
    if (trimmed && !seen.has(trimmed.toLowerCase())) seen.set(trimmed.toLowerCase(), trimmed);
  }
  return [...seen.values()];
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}
