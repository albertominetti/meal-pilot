import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { AppConfigService } from '../config/app-config.service';
import { runMigrations } from './migrate';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;
export type DbStatus = 'up' | 'down' | 'disabled';

const SLOW_QUERY_MS = 500;

/** Errors worth one retry: Neon waking from scale-to-zero, dropped sockets. */
export function isConnectionError(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  if (e?.code && /^(ECONNREFUSED|ECONNRESET|ETIMEDOUT|EPIPE|57P01|57P03|08\w{3})$/.test(e.code)) {
    return true;
  }
  return /connection terminated|timeout exceeded when trying to connect/i.test(e?.message ?? '');
}

/**
 * One pg pool against the pooled DATABASE_URL, or nothing when it is empty
 * (file stores are used then). PgBouncer runs in transaction mode, so code
 * here must avoid session SET, LISTEN/NOTIFY and session advisory locks.
 */
@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly pool: Pool | null;
  private readonly database: Db | null;
  private migrations?: Promise<void>;

  constructor(private readonly config: AppConfigService) {
    const url = config.databaseUrl;
    if (!url) {
      this.pool = null;
      this.database = null;
      return;
    }
    this.pool = new Pool({
      connectionString: url,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    // Never log the error object itself: it can carry connection details.
    this.pool.on('error', (err) => this.logger.error(`Postgres pool error: ${err.message}`));
    this.database = drizzle(this.pool, { schema });
  }

  get enabled(): boolean {
    return this.database !== null;
  }

  async onModuleInit(): Promise<void> {
    await this.ready();
  }

  /**
   * Migrates once over the direct URL when it is set. Every query waits for
   * it, because Nest doesn't order init hooks across modules.
   */
  ready(): Promise<void> {
    if (!this.migrations) {
      const directUrl = this.config.databaseUrlDirect;
      this.migrations =
        this.enabled && directUrl
          ? runMigrations(directUrl).then(() => this.logger.log('Database migrations applied'))
          : Promise.resolve();
    }
    return this.migrations;
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }

  /** Runs a query, retrying once on connection errors, and logs slow ones. */
  async run<T>(label: string, fn: (db: Db) => Promise<T>): Promise<T> {
    if (!this.database) throw new Error('Database is not configured');
    await this.ready();
    const startedAt = Date.now();
    try {
      return await fn(this.database);
    } catch (err) {
      if (!isConnectionError(err)) throw err;
      this.logger.warn(`${label}: connection error, retrying once`);
      return await fn(this.database);
    } finally {
      const ms = Date.now() - startedAt;
      if (ms > SLOW_QUERY_MS) this.logger.warn(`${label} took ${ms} ms`);
      else this.logger.debug(`${label} took ${ms} ms`);
    }
  }

  /** SELECT 1 with a short timeout, so a cold start reports down, not a hang. */
  async ping(timeoutMs = 2_000): Promise<DbStatus> {
    if (!this.pool) return 'disabled';
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.pool.query('SELECT 1'),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
        }),
      ]);
      return 'up';
    } catch {
      return 'down';
    } finally {
      clearTimeout(timer);
    }
  }
}
