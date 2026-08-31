import { injectable } from 'tsyringe';
import { sql } from 'drizzle-orm';
import { db } from '../../db';
import { PERMISSIONS } from '../../permissions';
import type { RequestContext } from '../RequestContext';
import { BaseService } from '../BaseService';
import logger from '../../utils/logger';
import { statusPageResponseSchema } from '../../http/contracts/statusPage';
import type { StatusCheck, StatusDaily, StatusPageResponse, StatusProvider, StatusWindow } from '../../http/contracts/statusPage';
import type { HealthCheckStatus } from '../../http/contracts/monitoring';

/** Display labels for the checks the live HealthCheckService writes (SPEC-status-page-v1 §5.7). */
const CHECK_LABELS: Record<string, string> = {
  db: 'Database',
  process: 'Application',
  'service_heartbeat:conversation-timeout': 'Conversation Timeout Service',
  'service_heartbeat:processing-deferral': 'Processing Deferral Service',
  'service_heartbeat:scenario-run-executor': 'Scenario Run Executor',
  'service_heartbeat:benchmark-executor': 'Benchmark Executor',
  'service_heartbeat:imap-inbound': 'IMAP Inbound',
  'service_heartbeat:oauth2-token-refresh': 'OAuth2 Token Refresh',
  'service_heartbeat:health-checks': 'Health Checks',
};

const HEARTBEAT_PREFIX = 'service_heartbeat:';
const PROVIDER_PREFIX = 'provider:';
const CORE_CHECKS = new Set(['db', 'process']);
const GROUP_RANK: Record<StatusCheck['group'], number> = { core: 0, service: 1, other: 2 };

/**
 * Worst non-unknown status in the set (SPEC-status-page-v1 §4.3): `down > degraded > ok`,
 * with `unknown` neutral — returned only when the set holds no non-unknown status.
 * Exported for direct testing (the live 1 s test-loop makes an all-unknown API scenario racy).
 */
export function worstNonUnknownStatus(statuses: Iterable<HealthCheckStatus | null | undefined>): HealthCheckStatus {
  const rank: Record<Exclude<HealthCheckStatus, 'unknown'>, number> = { ok: 1, degraded: 2, down: 3 };
  let worst: HealthCheckStatus = 'unknown';
  let worstRank = 0;
  for (const status of statuses) {
    if (!status || status === 'unknown') continue;
    if (rank[status] > worstRank) {
      worstRank = rank[status];
      worst = status;
    }
  }
  return worst;
}

/** Title-cases a kebab-case heartbeat suffix for display (foo-bar-baz → Foo Bar Baz). */
function titleCase(value: string): string {
  return value
    .split('-')
    .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join(' ');
}

interface LatestCheckRow {
  check_name: string;
  status: HealthCheckStatus;
  latency_ms: number | null;
  detail: Record<string, unknown> | null;
  created_at: Date | null;
}

interface WindowCountRow {
  check_name: string;
  total: number;
  ok: number;
  degraded: number;
  down: number;
  unknown: number;
}

interface ProviderIdentityRow {
  id: string;
  name: string;
  provider_type: StatusProvider['providerType'];
  api_type: string;
}

interface DailyAggRow {
  date: string;
  total: number;
  ok: number;
  degraded: number;
  down: number;
  unknown: number;
}

/**
 * Status page service (SPEC-status-page-v1) — aggregates `health_checks` + `providers`
 * into the current-state payload rendered by the Console Status page.
 *
 * Read-only. No caching (the Console polls at ~30 s and the queries are indexed
 * range scans over a few hundred rows; SPEC §6.3).
 */
@injectable()
export class StatusPageService extends BaseService {
  /**
   * Build the status page payload. `windowMinutes` and `days` must be pre-validated
   * (statusPageQuerySchema: windowMinutes int 5–1440 default 60; days int 1–90 optional —
   * when set, `daily` carries N per-UTC-day buckets: today + the preceding N-1 days).
   */
  async getStatus(context: RequestContext, windowMinutes = 60, days?: number): Promise<StatusPageResponse> {
    this.requirePermission(context, PERMISSIONS.SYSTEM_MONITORING);
    logger.debug({ operatorId: context.operatorId, windowMinutes, days }, 'Building status page payload');

    const dailyPromise = days ? this.fetchDailyAggregates(days) : Promise.resolve(undefined as DailyAggRow[] | undefined);
    const [latestRows, windowRows, providerRows, dailyRows] = await Promise.all([
      this.fetchLatestChecks(),
      this.fetchWindowCounts(windowMinutes),
      this.fetchProviderIdentities(),
      dailyPromise,
    ]);

    const providerById = new Map(providerRows.map((row) => [row.id, row]));
    const latestByCheck = new Map(latestRows.map((row) => [row.check_name, row]));
    const windowByCheck = new Map(windowRows.map((row) => [row.check_name, row]));

    const checks: StatusCheck[] = [];
    for (const row of latestRows) {
      if (row.check_name.startsWith(PROVIDER_PREFIX)) continue; // provider:* rows are rendered via providers[]
      checks.push({
        name: row.check_name,
        label: this.labelForCheck(row.check_name, providerById),
        group: this.groupForCheck(row.check_name),
        status: row.status,
        latencyMs: row.latency_ms,
        detail: row.detail,
        checkedAt: row.created_at,
        window: this.buildWindow(windowByCheck.get(row.check_name)),
      });
    }
    checks.sort((a, b) => GROUP_RANK[a.group] - GROUP_RANK[b.group] || a.name.localeCompare(b.name));

    const providers: StatusProvider[] = providerRows
      .map((provider) => {
        const checkName = `${PROVIDER_PREFIX}${provider.id}`;
        const latest = latestByCheck.get(checkName);
        return {
          id: provider.id,
          name: provider.name,
          providerType: provider.provider_type,
          apiType: provider.api_type,
          status: latest?.status ?? 'unknown',
          latencyMs: latest?.latency_ms ?? null,
          detail: latest?.detail ?? null,
          checkedAt: latest?.created_at ?? null,
          window: this.buildWindow(windowByCheck.get(checkName)),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id));

    const overall = worstNonUnknownStatus([...checks.map((check) => check.status), ...providers.map((provider) => provider.status)]);

    const payload: Record<string, unknown> = { generatedAt: new Date(), windowMinutes, overall, checks, providers };
    if (dailyRows) payload.daily = dailyRows.map((row) => this.buildDaily(row));
    return statusPageResponseSchema.parse(payload);
  }

  /** Latest row per check name (index: idx_health_checks_check_created). */
  private async fetchLatestChecks(): Promise<LatestCheckRow[]> {
    const result = await db.execute(sql`
      SELECT check_name, status, latency_ms, detail, created_at
      FROM (
        SELECT DISTINCT ON (check_name) check_name, status, latency_ms, detail, created_at
        FROM health_checks
        ORDER BY check_name, created_at DESC
      ) latest
    `);
    return result.rows as unknown as LatestCheckRow[];
  }

  /**
   * Per-UTC-day aggregates for the last `days` days (today + the preceding days-1).
   * Zero-filled via a generate_series LEFT JOIN — days without rows still appear.
   * All day math runs in Postgres on the DB clock (the same clock that stamped the
   * rows via the `defaultNow()` column default); dates come back as to_char strings
   * so pg's local-timezone DATE parsing is never involved (RetentionService TZ notes).
   */
  private async fetchDailyAggregates(days: number): Promise<DailyAggRow[]> {
    const result = await db.execute(sql`
      WITH day_series AS (
        SELECT generate_series(
                 (date_trunc('day', now()) - make_interval(days => ${days - 1}))::date,
                 date_trunc('day', now())::date,
                 interval '1 day'
               )::date AS day
      ),
      day_counts AS (
        SELECT created_at::date AS day,
               COUNT(*)::int                                    AS total,
               COUNT(*) FILTER (WHERE status = 'ok')::int       AS ok,
               COUNT(*) FILTER (WHERE status = 'degraded')::int AS degraded,
               COUNT(*) FILTER (WHERE status = 'down')::int     AS down,
               COUNT(*) FILTER (WHERE status = 'unknown')::int  AS "unknown"
        FROM health_checks
        WHERE created_at >= date_trunc('day', now()) - make_interval(days => ${days - 1})
        GROUP BY 1
      )
      SELECT to_char(s.day, 'YYYY-MM-DD') AS date,
             COALESCE(c.total, 0)         AS total,
             COALESCE(c.ok, 0)            AS ok,
             COALESCE(c.degraded, 0)      AS degraded,
             COALESCE(c.down, 0)          AS down,
             COALESCE(c."unknown", 0)     AS "unknown"
      FROM day_series s
      LEFT JOIN day_counts c ON c.day = s.day
      ORDER BY s.day ASC
    `);
    return result.rows as unknown as DailyAggRow[];
  }

  /**
   * Per-check status counts over the window. The boundary is computed in Postgres
   * (`now() - make_interval(...)` — the same DB clock that stamped the rows via the
   * `defaultNow()` column default), so the app clock's timezone can never disagree
   * (see the RetentionService TZ notes).
   */
  private async fetchWindowCounts(windowMinutes: number): Promise<WindowCountRow[]> {
    const result = await db.execute(sql`
      SELECT check_name,
             COUNT(*)::int                                    AS total,
             COUNT(*) FILTER (WHERE status = 'ok')::int       AS ok,
             COUNT(*) FILTER (WHERE status = 'degraded')::int AS degraded,
             COUNT(*) FILTER (WHERE status = 'down')::int     AS down,
             COUNT(*) FILTER (WHERE status = 'unknown')::int  AS "unknown"
      FROM health_checks
      WHERE created_at >= now() - make_interval(mins => ${windowMinutes})
      GROUP BY check_name
    `);
    return result.rows as unknown as WindowCountRow[];
  }

  /** Provider identity rows — the providers table drives providers[] (orphan check rows are dropped). */
  private async fetchProviderIdentities(): Promise<ProviderIdentityRow[]> {
    const result = await db.execute(sql`SELECT id, name, provider_type, api_type FROM providers`);
    return result.rows as unknown as ProviderIdentityRow[];
  }

  /** Derives the daily status + strict uptimePct from raw per-day counts. */
  private buildDaily(row: DailyAggRow): StatusDaily {
    const measured = row.total - row.unknown;
    return {
      date: row.date,
      total: row.total,
      ok: row.ok,
      degraded: row.degraded,
      down: row.down,
      unknown: row.unknown,
      status: worstNonUnknownStatus([row.down > 0 ? 'down' : null, row.degraded > 0 ? 'degraded' : null, row.ok > 0 ? 'ok' : null]),
      uptimePct: measured > 0 ? Math.round((row.ok / measured) * 10_000) / 100 : null,
    };
  }

  /** Window object for one check; an absent row is an all-zero window with worstStatus unknown. */
  private buildWindow(row: WindowCountRow | undefined): StatusWindow {
    const total = row?.total ?? 0;
    const ok = row?.ok ?? 0;
    const degraded = row?.degraded ?? 0;
    const down = row?.down ?? 0;
    const unknown = row?.unknown ?? 0;
    const worstStatus = worstNonUnknownStatus([
      down > 0 ? 'down' : null,
      degraded > 0 ? 'degraded' : null,
      ok > 0 ? 'ok' : null,
    ]);
    return { total, ok, degraded, down, unknown, worstStatus };
  }

  private groupForCheck(name: string): StatusCheck['group'] {
    if (CORE_CHECKS.has(name)) return 'core';
    if (name.startsWith(HEARTBEAT_PREFIX)) return 'service';
    return 'other';
  }

  /** Label map with fallbacks — the endpoint must never fail on an unknown check name (SPEC §8). */
  private labelForCheck(name: string, providerById: Map<string, ProviderIdentityRow>): string {
    if (CHECK_LABELS[name]) return CHECK_LABELS[name];
    if (name.startsWith(HEARTBEAT_PREFIX)) return titleCase(name.slice(HEARTBEAT_PREFIX.length));
    if (name.startsWith(PROVIDER_PREFIX)) return providerById.get(name.slice(PROVIDER_PREFIX.length))?.name ?? name;
    return name;
  }
}
