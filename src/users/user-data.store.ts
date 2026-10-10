import { Injectable, Logger } from '@nestjs/common';
import { and, eq, isNull, lt } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';
import { DatabaseService } from '../db/database.service';
import { mealLogs, plans, profiles } from '../db/schema';
import { MealPlanRequestDto } from '../meal-plan/dto/meal-plan-request.dto';
import { ProfileFieldsDto } from '../meal-plan/dto/profile-fields.dto';
import { RecommendationDto } from '../meal-plan/dto/meal-plan-response.dto';
import { ShoppingList } from '../shopping/shopping-list';

export const USER_DATA_STORE = Symbol('USER_DATA_STORE');

/** Plans without a user are kept this long; user plans until the user is deleted. */
export const ANONYMOUS_PLAN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type ProfileData = ProfileFieldsDto;

export interface StoredProfile {
  userId: string;
  profile: ProfileData;
  consentAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredPlan {
  id: string;
  userId: string | null;
  version: number;
  /** Effective profile the plan was built for (stored profile merged with inline fields). */
  request: MealPlanRequestDto;
  items: RecommendationDto[];
  shoppingList: ShoppingList;
  /** Shopping-list item keys the user ticked. */
  checked: string[];
  createdAt: string;
  updatedAt: string;
}

export interface MealLog {
  id: string;
  userId: string;
  videoId: string;
  planId: string | null;
  cooked: boolean;
  rating: number | null;
  note: string | null;
  createdAt: string;
}

export interface DeletedUserData {
  profiles: number;
  plans: number;
  meals: number;
}

export interface UserDataStore {
  getProfile(userId: string): Promise<StoredProfile | null>;
  putProfile(profile: StoredProfile): Promise<void>;
  /** GDPR erasure: the profile, every plan and every meal log of the user. */
  deleteUser(userId: string): Promise<DeletedUserData>;
  createPlan(plan: StoredPlan): Promise<void>;
  getPlan(id: string): Promise<StoredPlan | null>;
  /** Optimistic: writes only when the stored version is still `plan.version - 1`. */
  updatePlan(plan: StoredPlan): Promise<boolean>;
  addMeal(log: MealLog): Promise<void>;
  listMeals(userId: string): Promise<MealLog[]>;
  deleteAnonymousPlansBefore(cutoff: Date): Promise<number>;
}

interface FileData {
  profiles: Record<string, StoredProfile>;
  plans: Record<string, StoredPlan>;
  meals: MealLog[];
}

/**
 * One JSON file for local runs without a database. Production refuses to
 * boot without DATABASE_URL, so health data never lands on Render's disk.
 */
export class FileUserDataStore implements UserDataStore {
  private readonly logger = new Logger(FileUserDataStore.name);
  private data: FileData | null = null;

  private file(): string {
    const dir = process.env.MEALPILOT_CACHE_DIR || path.join(process.cwd(), 'data', 'cache');
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, 'user-data.json');
  }

  private load(): FileData {
    if (!this.data) {
      try {
        this.data = JSON.parse(fs.readFileSync(this.file(), 'utf8'));
      } catch {
        this.data = { profiles: {}, plans: {}, meals: [] };
      }
    }
    return this.data!;
  }

  private save(): void {
    try {
      fs.writeFileSync(this.file(), JSON.stringify(this.data, null, 2));
    } catch (err) {
      this.logger.warn(`Could not persist user data: ${(err as Error).message}`);
    }
  }

  async getProfile(userId: string) {
    return this.load().profiles[userId] ?? null;
  }

  async putProfile(profile: StoredProfile) {
    this.load().profiles[profile.userId] = profile;
    this.save();
  }

  async deleteUser(userId: string): Promise<DeletedUserData> {
    const d = this.load();
    const profileCount = d.profiles[userId] ? 1 : 0;
    delete d.profiles[userId];
    const planIds = Object.values(d.plans).filter((p) => p.userId === userId).map((p) => p.id);
    for (const id of planIds) delete d.plans[id];
    const before = d.meals.length;
    d.meals = d.meals.filter((m) => m.userId !== userId);
    this.save();
    return { profiles: profileCount, plans: planIds.length, meals: before - d.meals.length };
  }

  async createPlan(plan: StoredPlan) {
    this.load().plans[plan.id] = plan;
    this.save();
  }

  async getPlan(id: string) {
    return this.load().plans[id] ?? null;
  }

  async updatePlan(plan: StoredPlan) {
    const d = this.load();
    if (d.plans[plan.id]?.version !== plan.version - 1) return false;
    d.plans[plan.id] = plan;
    this.save();
    return true;
  }

  async addMeal(log: MealLog) {
    this.load().meals.push(log);
    this.save();
  }

  async listMeals(userId: string) {
    return this.load().meals.filter((m) => m.userId === userId);
  }

  async deleteAnonymousPlansBefore(cutoff: Date) {
    const d = this.load();
    const old = Object.values(d.plans).filter((p) => p.userId === null && new Date(p.createdAt) < cutoff);
    for (const p of old) delete d.plans[p.id];
    if (old.length) this.save();
    return old.length;
  }
}

@Injectable()
export class PgUserDataStore implements UserDataStore {
  constructor(private readonly database: DatabaseService) {}

  async getProfile(userId: string): Promise<StoredProfile | null> {
    const rows = await this.database.run('profiles.get', (db) =>
      db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1),
    );
    const r = rows[0];
    return r
      ? {
          userId: r.userId,
          profile: r.data as ProfileData,
          consentAt: r.consentAt.toISOString(),
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        }
      : null;
  }

  async putProfile(p: StoredProfile): Promise<void> {
    const values = { data: p.profile, consentAt: new Date(p.consentAt), updatedAt: new Date(p.updatedAt) };
    await this.database.run('profiles.put', (db) =>
      db
        .insert(profiles)
        .values({ userId: p.userId, createdAt: new Date(p.createdAt), ...values })
        .onConflictDoUpdate({ target: profiles.userId, set: values }),
    );
  }

  async deleteUser(userId: string): Promise<DeletedUserData> {
    return this.database.run('users.delete', (db) =>
      db.transaction(async (tx) => {
        const p = await tx.delete(profiles).where(eq(profiles.userId, userId)).returning({ id: profiles.userId });
        const pl = await tx.delete(plans).where(eq(plans.userId, userId)).returning({ id: plans.id });
        const m = await tx.delete(mealLogs).where(eq(mealLogs.userId, userId)).returning({ id: mealLogs.id });
        return { profiles: p.length, plans: pl.length, meals: m.length };
      }),
    );
  }

  private planRow(p: StoredPlan) {
    return {
      id: p.id,
      userId: p.userId,
      version: p.version,
      request: p.request,
      items: p.items,
      shoppingList: p.shoppingList,
      checked: p.checked,
      createdAt: new Date(p.createdAt),
      updatedAt: new Date(p.updatedAt),
    };
  }

  async createPlan(plan: StoredPlan): Promise<void> {
    await this.database.run('plans.create', (db) => db.insert(plans).values(this.planRow(plan)));
  }

  async getPlan(id: string): Promise<StoredPlan | null> {
    const rows = await this.database.run('plans.get', (db) => db.select().from(plans).where(eq(plans.id, id)).limit(1));
    const r = rows[0];
    return r
      ? {
          id: r.id,
          userId: r.userId,
          version: r.version,
          request: r.request as MealPlanRequestDto,
          items: r.items as RecommendationDto[],
          shoppingList: r.shoppingList as ShoppingList,
          checked: r.checked,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        }
      : null;
  }

  async updatePlan(plan: StoredPlan): Promise<boolean> {
    const row: Partial<ReturnType<PgUserDataStore['planRow']>> = this.planRow(plan);
    const id = plan.id;
    delete row.id;
    delete row.createdAt;
    const updated = await this.database.run('plans.update', (db) =>
      db
        .update(plans)
        .set(row)
        .where(and(eq(plans.id, id), eq(plans.version, plan.version - 1)))
        .returning({ id: plans.id }),
    );
    return updated.length === 1;
  }

  async addMeal(log: MealLog): Promise<void> {
    await this.database.run('meals.add', (db) =>
      db.insert(mealLogs).values({ ...log, createdAt: new Date(log.createdAt) }),
    );
  }

  async listMeals(userId: string): Promise<MealLog[]> {
    const rows = await this.database.run('meals.list', (db) =>
      db.select().from(mealLogs).where(eq(mealLogs.userId, userId)).orderBy(mealLogs.createdAt),
    );
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  }

  async deleteAnonymousPlansBefore(cutoff: Date): Promise<number> {
    const deleted = await this.database.run('plans.cleanup', (db) =>
      db
        .delete(plans)
        .where(and(isNull(plans.userId), lt(plans.createdAt, cutoff)))
        .returning({ id: plans.id }),
    );
    return deleted.length;
  }
}
