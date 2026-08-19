import 'reflect-metadata';
import { describe, it, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import { and, eq, sql } from 'drizzle-orm';
import { resetDatabase } from '../utils';
import { container } from 'tsyringe';
import { db } from '../../src/db/index';
import { alertEvents, providerCallLogs } from '../../src/db/schema';
import { CallLogger } from '../../src/services/monitoring/CallLogger';
import type { MonitoringConfig } from '../../src/http/contracts/monitoring';
import type { MonitoringConfigService } from '../../src/services/monitoring/MonitoringConfigService';
import type { AlertRuleEngine } from '../../src/services/monitoring/AlertRuleEngine';

/**
 * P2-01 e2e — alert rule engine against the LIVE app (real DB, real
 * HealthCheckService at 1s cycles, engine interval 1s via
 * MONITORING_ALERT_ENGINE_INTERVAL_MS).
 *
 * Config is injected through the engine's `setConfigProviderForTests` seam:
 * the app-world MonitoringConfigService singleton can live in a different
 * module graph than the test's, and its cache would hide test-saved rows.
 * The seam makes the config the engine sees exactly what the test provides.
 *
 * The engine also ticks on its own 1s interval while these tests run — that
 * is intentional: the assertions are on final DB state, which the manual
 * runNow() calls and the automatic ticks converge to identically (the
 * state machine is idempotent per pass).
 */

function configService(): MonitoringConfigService {
  const svc = (globalThis as any).__TEST_MONITORING_CONFIG__ as MonitoringConfigService | undefined;
  expect(svc).to.not.equal(undefined, '__TEST_MONITORING_CONFIG__ is not set — tests/setup.ts must expose the app-world config service');
  return svc;
}

function engine(): AlertRuleEngine {
  const svc = (globalThis as any).__TEST_ALERT_ENGINE__ as AlertRuleEngine | undefined;
  expect(svc).to.not.equal(undefined, '__TEST_ALERT_ENGINE__ is not set — tests/setup.ts must expose the app-world alert engine');
  return svc;
}

/** Base config from the app-world service (schema-valid), with a rule override. */
async function useConfig(engine: AlertRuleEngine, ruleId: string, override: Record<string, unknown>): Promise<void> {
  const base: MonitoringConfig = await configService().get();
  engine.setConfigProviderForTests(async () => ({
    ...base,
    rules: { ...base.rules, [ruleId]: override },
  }));
}

async function alertsFor(ruleId: string, scopeKey?: string) {
  return scopeKey
    ? db.select().from(alertEvents).where(and(eq(alertEvents.ruleId, ruleId), eq(alertEvents.scopeKey, scopeKey)))
    : db.select().from(alertEvents).where(eq(alertEvents.ruleId, ruleId));
}

/**
 * The engine invokes the publisher fire-and-forget, so the alert row can land
 * a few ms after runNow() resolves — poll until the expected state appears.
 */
async function waitForAlerts(ruleId: string, scopeKey: string | undefined, expectStatus: string, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const rows = await alertsFor(ruleId, scopeKey);
    if (rows.length > 0 && rows.every((r) => r.status === expectStatus)) return rows;
    if (Date.now() > deadline) return rows;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe('Alert rule engine (P2-01, e2e)', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterEach(async () => {
    // Restore production config loading for the other suites' 1s engine ticks.
    engine().setConfigProviderForTests(null);
  });

  it('high-memory: full fire → resolve trail on alert_events via config + live engine', async () => {
    const eng = engine();
    // 1-byte threshold: any live process RSS exceeds it → immediate fire.
    await useConfig(eng, 'high-memory', {
      threshold: 1, forMinutes: 0, resolveAfterGoodChecks: 1, cooldownMinutes: 0,
    });
    await eng.runNow();

    let rows = await waitForAlerts('high-memory', undefined, 'firing');
    expect(rows.length).to.equal(1);
    expect(rows[0].scopeKey).to.equal('high-memory:global');
    expect(rows[0].severity).to.equal('warning');
    expect(rows[0].status).to.equal('firing');
    expect(rows[0].message).to.contain('MB');
    expect(rows[0].context.rssBytes).to.be.greaterThan(1);

    // Raise the threshold far above any possible RSS → resolves on the next pass.
    await useConfig(eng, 'high-memory', {
      threshold: 1_000_000_000_000, forMinutes: 0, resolveAfterGoodChecks: 1, cooldownMinutes: 0,
    });
    await eng.runNow();

    rows = await waitForAlerts('high-memory', undefined, 'resolved');
    expect(rows.length).to.equal(1);
    expect(rows[0].status).to.equal('resolved');
    expect(rows[0].resolvedAt).to.not.equal(null);
    expect(rows[0].context.resolutionReason).to.equal('auto');
  });

  it('provider-down: forced failing call rows fire, aged-out rows resolve', async () => {
    const eng = engine();
    const callLogger = container.resolve(CallLogger);
    for (let i = 0; i < 5; i++) {
      callLogger.record({
        providerId: 'prov_e2e_down',
        providerType: 'llm',
        apiType: 'openai',
        operation: 'llm.generate',
        ok: false,
        errorCode: 'unavailable',
        statusHttp: 500,
        durationMs: 1200,
        errorText: 'ECONNREFUSED',
      });
    }
    await callLogger.flushNow();

    await useConfig(eng, 'provider-down', {
      forMinutes: 0, resolveAfterGoodChecks: 1, cooldownMinutes: 0,
    });
    await eng.runNow();

    let rows = await waitForAlerts('provider-down', 'provider-down:prov_e2e_down', 'firing');
    expect(rows.length).to.equal(1);
    expect(rows[0].severity).to.equal('critical');
    expect(rows[0].status).to.equal('firing');
    expect(rows[0].scope.providerId).to.equal('prov_e2e_down');
    expect(rows[0].message).to.contain('100% of 5');

    // Age the call rows out of the 10-minute rule window → the next pass sees
    // no data for the provider and resolves the firing alert (findings 11/13).
    await db
      .update(providerCallLogs)
      .set({ createdAt: sql`created_at - interval '11 minutes'` })
      .where(eq(providerCallLogs.providerId, 'prov_e2e_down'));
    await eng.runNow();

    rows = await waitForAlerts('provider-down', 'provider-down:prov_e2e_down', 'resolved');
    expect(rows.length).to.equal(1);
    expect(rows[0].status).to.equal('resolved');
    expect(rows[0].context.resolutionReason).to.equal('auto');
  });
});
