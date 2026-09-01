import 'reflect-metadata';
import { describe, it, before, beforeEach, after } from 'mocha';
import { expect } from 'chai';
import request from 'supertest';
import { authed, unauthed, resetDatabase } from '../utils';
import { db } from '../../src/db/index';
import { alertEvents, monitoringConfig } from '../../src/db/schema';
import { PERMISSIONS, ROLES } from '../../src/permissions';
import { monitoringConfigSchema } from '../../src/http/contracts/monitoring';

/**
 * P2-04 e2e — RBAC completion: the 11-route × 5-role (+ unauthenticated)
 * 403/401 matrix, the source-level grant drift guard, and audit-visibility
 * verification (viewer can READ the sanitized ack/config audit entries via
 * /api/audit-logs while remaining 403 on every monitoring route).
 *
 * The role matrix is "super_admin only" — already true in src/permissions.ts;
 * this suite proves and locks it (see spec, implementation notes 1 + 9).
 */

const TEST_OPERATOR_ID = 'test@example.com';
const WEBHOOK_TOKEN = 'SECRET404TOKEN';

// The monitoring routes (6 P1-08 reads + 1 metric catalog + 3 alerts + 2 config + 1 rule catalog).
// provider-stats requires a bounded from/to window — supplied per request.
type MatrixRoute = { method: 'GET' | 'POST' | 'PUT'; path: string; query?: Record<string, string> | (() => Record<string, string>) };
const ROUTES: MatrixRoute[] = [
  { method: 'GET', path: '/api/monitoring/health' },
  { method: 'GET', path: '/api/monitoring/health/history' },
  { method: 'GET', path: '/api/monitoring/providers' },
  { method: 'GET', path: '/api/monitoring/provider-calls' },
  {
    method: 'GET',
    path: '/api/monitoring/provider-stats',
    query: () => {
      const to = Date.now();
      return { from: new Date(to - 3600_000).toISOString(), to: new Date(to).toISOString() };
    },
  },
  {
    method: 'GET',
    path: '/api/monitoring/metrics',
    // name is required and must be a registered metric (P1-04 registers api_request_total).
    query: () => {
      const to = Date.now();
      return {
        name: 'api_request_total',
        from: new Date(to - 3600_000).toISOString(),
        to: new Date(to).toISOString(),
      };
    },
  },
  { method: 'GET', path: '/api/monitoring/metric-catalog' },
  { method: 'GET', path: '/api/monitoring/alerts' },
  { method: 'GET', path: '/api/monitoring/alerts/alrt_rbac' },
  { method: 'POST', path: '/api/monitoring/alerts/alrt_rbac/acknowledge' },
  { method: 'GET', path: '/api/monitoring/config' },
  { method: 'PUT', path: '/api/monitoring/config' },
  { method: 'GET', path: '/api/monitoring/rules' },
  { method: 'GET', path: '/api/monitoring/fallback-events' },
];

/** Create a single-role operator (survives resetDatabase) and return a token agent. */
async function roleAgent(role: string, tag: string) {
  const operatorId = `${tag}-p204@example.com`;
  const created = await authed()
    .post('/api/operators')
    .send({ id: operatorId, name: `P204 ${role}`, roles: [role], password: 'rolepass123' });
  expect([201, 409]).to.include(created.status);
  const login = await unauthed().post('/api/auth/login').send({ id: operatorId, password: 'rolepass123' });
  expect(login.status).to.equal(200);
  const app = (globalThis as any).__TEST_APP__;
  const agent = request.agent(app);
  agent.set('Authorization', `Bearer ${login.body.accessToken}`);
  return agent;
}

async function seedAlertRow(): Promise<void> {
  await db.insert(alertEvents).values({
    id: 'alrt_rbac',
    ruleId: 'rule_rbac',
    scopeKey: 'rule_rbac:global',
    scope: {},
    severity: 'warning',
    status: 'firing',
    message: 'rbac matrix fixture',
    context: {},
    notifications: [],
    firedAt: new Date(),
  });
}

/** No-op PUT body: round-trip the current config (super_admin only). */
async function noopPutBody() {
  const res = await authed().get('/api/monitoring/config');
  expect(res.status).to.equal(200);
  return { version: res.body.version, config: res.body.config };
}

async function hit(agent: { get: any; post: any; put: any }, route: MatrixRoute, body?: unknown): Promise<number> {
  const query = typeof route.query === 'function' ? route.query() : route.query;
  const res =
    route.method === 'GET'
      ? await agent.get(route.path).query(query ?? {})
      : route.method === 'POST'
        ? await agent.post(route.path)
        : await agent.put(route.path).send(body);
  return res.status;
}

describe('Monitoring RBAC completion (P2-04, e2e)', () => {
  const roles: Record<string, any> = {};

  before(async () => {
    roles.developer = await roleAgent('developer', 'developer');
    roles.content_manager = await roleAgent('content_manager', 'content-manager');
    roles.support = await roleAgent('support', 'support');
    roles.viewer = await roleAgent('viewer', 'viewer');
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedAlertRow();
  });

  after(async () => {
    // The audit test leaves a tokenized webhook notifier in the persisted
    // config row (monitoring_config survives resetDatabase) — restore the
    // clean default so later suites see pristine state.
    const res = await authed().get('/api/monitoring/config');
    expect(res.status).to.equal(200);
    const restore = await authed()
      .put('/api/monitoring/config')
      .send({ version: res.body.version, config: monitoringConfigSchema.parse({}) });
    expect(restore.status).to.equal(200);
  });

  it('grants in src/permissions.ts match the matrix exactly (super_admin only)', () => {
    const roleNames = Object.keys(ROLES);
    expect(roleNames).to.have.members(['super_admin', 'content_manager', 'support', 'developer', 'viewer']);
    expect(ROLES.super_admin.permissions).to.include(PERMISSIONS.SYSTEM_MONITORING);
    for (const role of roleNames) {
      if (role === 'super_admin') continue;
      expect(
        ROLES[role].permissions,
        `role '${role}' must NOT be granted system:monitoring`,
      ).to.not.include(PERMISSIONS.SYSTEM_MONITORING);
    }
  });

  it(`super_admin gets 200 on all ${ROUTES.length} monitoring routes`, async () => {
    const agent = authed();
    const putBody = await noopPutBody();
    for (const route of ROUTES) {
      const status = await hit(agent, route, putBody);
      expect(status, `${route.method} ${route.path}`).to.equal(200);
    }
  });

  for (const role of ['developer', 'content_manager', 'support', 'viewer']) {
    it(`${role} gets 403 on all ${ROUTES.length} monitoring routes`, async () => {
      const putBody = await noopPutBody();
      for (const route of ROUTES) {
        const status = await hit(roles[role], route, putBody);
        expect(status, `${role}: ${route.method} ${route.path}`).to.equal(403);
      }
    });
  }

  it(`unauthenticated gets 401 (not 403) on all ${ROUTES.length} monitoring routes`, async () => {
    const agent = unauthed();
    const putBody = { version: 1, config: monitoringConfigSchema.parse({}) };
    for (const route of ROUTES) {
      const status = await hit(agent, route, putBody);
      expect(status, `${route.method} ${route.path}`).to.equal(401);
    }
  });

  it('audit entries for ack + config PUT are readable via /api/audit-logs and sanitized', async () => {
    const admin = authed();

    // The mutating ops (actor = test operator).
    const ack = await admin.post('/api/monitoring/alerts/alrt_rbac/acknowledge');
    expect(ack.status).to.equal(200);

    const cfg = await admin.get('/api/monitoring/config');
    expect(cfg.status).to.equal(200);
    const put = await admin
      .put('/api/monitoring/config')
      .send({
        version: cfg.body.version,
        config: {
          ...cfg.body.config,
          retentionDays: 21,
          notifiers: [{ id: 'notf_audit', type: 'webhook', url: `https://hooks.example.com/hook?token=${WEBHOOK_TOKEN}`, enabled: true }],
        },
      });
    expect(put.status).to.equal(200);

    // A VIEWER (no system:monitoring, has audit:read) reads both entries.
    const viewer = roles.viewer;

    const ackEntries = await viewer.get('/api/audit-logs').query({ 'filters[action]': 'ACK' });
    expect(ackEntries.status).to.equal(200);
    expect(ackEntries.body.total).to.equal(1);
    expect(ackEntries.body.items[0]).to.include({
      action: 'ACK',
      entityType: 'alert_event',
      entityId: 'alrt_rbac',
      userId: TEST_OPERATOR_ID,
    });

    const cfgEntries = await viewer.get('/api/audit-logs').query({ 'filters[action]': 'UPDATE_MONITORING_CONFIG' });
    expect(cfgEntries.status).to.equal(200);
    expect(cfgEntries.body.total).to.equal(1);
    const entry = cfgEntries.body.items[0];
    expect(entry).to.include({
      action: 'UPDATE_MONITORING_CONFIG',
      entityType: 'monitoring_config',
      entityId: 'global',
      userId: TEST_OPERATOR_ID,
    });
    // Sanitization: the tokenized URL never reaches the readable audit payload.
    const newEntityJson = JSON.stringify(entry.newEntity);
    expect(newEntityJson).to.not.include(WEBHOOK_TOKEN);
    expect(newEntityJson).to.not.include('hooks.example.com');
    expect(newEntityJson).to.include('hasUrl');
    expect(newEntityJson).to.include('"retentionDays":21');
    const oldEntityJson = JSON.stringify(entry.oldEntity);
    expect(oldEntityJson).to.include(`"version":${cfg.body.version}`);

    // No escalation: the same viewer is still 403 on the monitoring routes.
    expect((await viewer.get('/api/monitoring/alerts')).status).to.equal(403);
    expect((await viewer.get('/api/monitoring/config')).status).to.equal(403);
  });
});
