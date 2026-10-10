import { Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';
import { DatabaseService } from '../db/database.service';
import { fdcMappings } from '../db/schema';
import { FdcFood, Nutrients, Portion } from './fdc-food';

export const FDC_MAPPING_STORE = Symbol('FDC_MAPPING_STORE');

/** A "no match" is retried after this long, in case FDC or the matcher improved. */
export const NO_MATCH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface FdcMapping {
  /** mappingKey(): normalised name, plus "|canned" for canned products. */
  key: string;
  food: FdcFood | null;
  updatedAt: string;
}

/** Ingredient-to-food mappings are kept permanently and shared by every video. */
export interface FdcMappingStore {
  get(key: string): Promise<FdcMapping | null>;
  set(mapping: FdcMapping): Promise<void>;
}

export function isUsable(mapping: FdcMapping | null): mapping is FdcMapping {
  if (!mapping) return false;
  return mapping.food !== null || Date.now() - new Date(mapping.updatedAt).getTime() < NO_MATCH_TTL_MS;
}

/** One JSON file next to the analysis cache, for runs without a database. */
export class FileFdcMappingStore implements FdcMappingStore {
  private readonly logger = new Logger(FileFdcMappingStore.name);
  private entries: Record<string, FdcMapping> | null = null;

  private file(): string {
    const dir = process.env.MEALPILOT_CACHE_DIR || path.join(process.cwd(), 'data', 'cache');
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, 'fdc-mappings.json');
  }

  private load(): Record<string, FdcMapping> {
    if (!this.entries) {
      try {
        this.entries = JSON.parse(fs.readFileSync(this.file(), 'utf8'));
      } catch {
        this.entries = {};
      }
    }
    return this.entries!;
  }

  async get(key: string): Promise<FdcMapping | null> {
    return this.load()[key] ?? null;
  }

  async set(mapping: FdcMapping): Promise<void> {
    const entries = this.load();
    entries[mapping.key] = mapping;
    try {
      fs.writeFileSync(this.file(), JSON.stringify(entries, null, 2));
    } catch (err) {
      this.logger.warn(`Could not persist FDC mappings: ${(err as Error).message}`);
    }
  }
}

@Injectable()
export class PgFdcMappingStore implements FdcMappingStore {
  constructor(private readonly database: DatabaseService) {}

  async get(key: string): Promise<FdcMapping | null> {
    const rows = await this.database.run('fdc.get', (db) =>
      db.select().from(fdcMappings).where(eq(fdcMappings.normalisedName, key)).limit(1),
    );
    const row = rows[0];
    if (!row) return null;
    return {
      key,
      food:
        row.fdcId === null
          ? null
          : {
              fdcId: row.fdcId,
              description: row.description ?? '',
              dataType: row.dataType ?? '',
              nutrients: (row.nutrients ?? {}) as Nutrients,
              portions: (row.portions ?? []) as Portion[],
            },
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async set(mapping: FdcMapping): Promise<void> {
    const values = {
      fdcId: mapping.food?.fdcId ?? null,
      description: mapping.food?.description ?? null,
      dataType: mapping.food?.dataType ?? null,
      nutrients: mapping.food?.nutrients ?? null,
      portions: mapping.food?.portions ?? null,
      updatedAt: new Date(mapping.updatedAt),
    };
    await this.database.run('fdc.set', (db) =>
      db
        .insert(fdcMappings)
        .values({ normalisedName: mapping.key, ...values })
        .onConflictDoUpdate({ target: fdcMappings.normalisedName, set: values }),
    );
  }
}
