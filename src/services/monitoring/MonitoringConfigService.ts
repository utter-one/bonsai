import { singleton } from 'tsyringe';
import { and, eq } from 'drizzle-orm';
import { db } from '../../db';
import { monitoringConfig } from '../../db/schema';
import { monitoringConfigSchema } from '../../http/contracts/monitoring';
import type { MonitoringConfig } from '../../http/contracts/monitoring';
import { OptimisticLockError } from '../../errors';
import { generateId } from '../../utils/idGenerator';
import logger from '../../utils/logger';

const GLOBAL_ID = 'global';
const MIN_RETENTION_DAYS = 7;

/**
 * P1-06 — singleton `monitoring_config` access with validation + optimistic
 * locking (PROPOSAL §3.2e/§4).
 *
 * Lazy: the first `get()` loads the row and, if it does not exist, inserts the
 * synthesized default config (env overrides applied **only** on synthesis —
 * `MONITORING_WEBHOOK_URL`, `MONITORING_EMAIL_PROVIDER_ID` +
 * `MONITORING_EMAIL_TO`, `MONITORING_RETENTION_DAYS`). After that the DB row
 * is the single source of truth; env vars no longer apply.
 *
 * Load policy: a row that fails validation never crashes the app — the
 * in-memory synthesized defaults are used and a pino error is logged. The
 * user's row is never overwritten on load; repair is via P2-03's PUT
 * (validated before write).
 *
 * No lifecycle hook — `server.ts` starts nothing for this service; the first
 * `get()` (HealthCheckService's first cycle or P2-03's GET) performs the load.
 *
 * P2-02: `@singleton` (was `@injectable`) — the cache must be shared so a
 * `save()`/`reload()` through any injection point (engine, NotifyingPublisher,
 * P2-03 endpoint) is visible to all of them without a restart. A plain
 * `@injectable()` gave every injection point its own private cache.
 */
@singleton()
export class MonitoringConfigService {
  private cache: MonitoringConfig | null = null;

  /** Cached config; first call loads (and upserts the default row if missing). */
  async get(): Promise<MonitoringConfig> {
    if (this.cache) return this.cache;
    await this.load();
    return this.cache!;
  }

  /** Re-read the row and re-validate. An invalid row keeps the last good cache + pino error. */
  async reload(): Promise<void> {
    this.cache = null;
    await this.load();
  }

  /**
   * Validate + persist a new config with optimistic locking (P2-03's PUT body).
   * Throws ZodError on invalid input, OptimisticLockError on version mismatch.
   */
  async save(config: unknown, expectedVersion: number): Promise<void> {
    const parsed = monitoringConfigSchema.parse(config);
    // Ensure the row exists from the DB (not the cache — P2-02: the cache can
    // be stale after an external truncate/restore and would skip the re-insert).
    let row = (await db.select().from(monitoringConfig).where(eq(monitoringConfig.id, GLOBAL_ID)))[0];
    if (!row) {
      await this.load(); // upserts the synthesized default row
      row = (await db.select().from(monitoringConfig).where(eq(monitoringConfig.id, GLOBAL_ID)))[0];
    }
    if (!row) {
      throw new OptimisticLockError('Monitoring config row is missing');
    }
    if (row.version !== expectedVersion) {
      throw new OptimisticLockError(
        `Monitoring config version mismatch. Expected ${expectedVersion}, got ${row.version}`,
      );
    }

    const updated = await db
      .update(monitoringConfig)
      .set({ config: parsed, version: row.version + 1, updatedAt: new Date() })
      .where(and(eq(monitoringConfig.id, GLOBAL_ID), eq(monitoringConfig.version, expectedVersion)))
      .returning();
    if (updated.length === 0) {
      throw new OptimisticLockError('Failed to update monitoring config due to version conflict');
    }
    this.cache = parsed;
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private async load(): Promise<void> {
    const rows = await db.select().from(monitoringConfig).where(eq(monitoringConfig.id, GLOBAL_ID));
    if (rows.length > 0) {
      this.cache = this.parseRowOrFallback(rows[0].config);
      return;
    }

    // First boot: insert the synthesized default (idempotent — two replicas
    // racing both insert, ON CONFLICT DO NOTHING, then re-select the winner).
    const defaults = this.synthesizeDefaults();
    await db
      .insert(monitoringConfig)
      .values({ id: GLOBAL_ID, config: defaults, version: 1 })
      .onConflictDoNothing();
    const after = await db.select().from(monitoringConfig).where(eq(monitoringConfig.id, GLOBAL_ID));
    this.cache = after.length > 0 ? this.parseRowOrFallback(after[0].config) : defaults;
    logger.info('MonitoringConfigService: created default monitoring_config row');
  }

  /**
   * Parse a stored config; on validation failure keep the in-memory
   * synthesized defaults (never clobber the user's row on load) + pino error.
   */
  private parseRowOrFallback(raw: unknown): MonitoringConfig {
    try {
      return monitoringConfigSchema.parse(raw);
    } catch (error) {
      logger.error(
        { error: (error as Error)?.message },
        'monitoring_config row failed validation — using in-memory defaults (fix via PUT /api/monitoring/config)',
      );
      return this.synthesizeDefaults();
    }
  }

  /**
   * Default config with env overrides. Env vars apply ONLY here (first boot);
   * afterwards the DB row is the source of truth.
   */
  protected synthesizeDefaults(): MonitoringConfig {
    const config = monitoringConfigSchema.parse({});
    const notifiers: MonitoringConfig['notifiers'] = [];

    const webhookUrl = process.env.MONITORING_WEBHOOK_URL;
    if (webhookUrl) {
      notifiers.push({ id: generateId('notf'), type: 'webhook', url: webhookUrl, enabled: true });
    }
    const emailProviderId = process.env.MONITORING_EMAIL_PROVIDER_ID;
    const emailTo = process.env.MONITORING_EMAIL_TO;
    if (emailProviderId && emailTo) {
      notifiers.push({
        id: generateId('notf'),
        type: 'email',
        channelProviderId: emailProviderId,
        to: emailTo,
        enabled: true,
      });
    }
    if (notifiers.length > 0) config.notifiers = notifiers;

    const retentionRaw = process.env.MONITORING_RETENTION_DAYS;
    if (retentionRaw !== undefined) {
      const parsed = Number.parseInt(retentionRaw, 10);
      if (Number.isInteger(parsed) && parsed >= MIN_RETENTION_DAYS) {
        config.retentionDays = parsed;
      } else {
        logger.warn(
          { retentionRaw, min: MIN_RETENTION_DAYS },
          'MONITORING_RETENTION_DAYS ignored (must be an integer >= 7) — using default retention',
        );
      }
    }
    return config;
  }
}
