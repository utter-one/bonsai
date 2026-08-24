import 'reflect-metadata';
import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { container } from 'tsyringe';
import { authed, resetDatabase } from '../utils';
import { db } from '../../src/db/index';
import { fallbackEvents } from '../../src/db/schema';
import { eq } from 'drizzle-orm';
import { FallbackEventService } from '../../src/services/monitoring/FallbackEventService';

function llmProvider(overrides: Record<string, unknown> = {}) {
  return {
    name: 'E2E LLM',
    providerType: 'llm',
    apiType: 'openai',
    config: { apiKey: 'sk-e2e-fallback-test' },
    ...overrides,
  };
}

async function createProvider(body: Record<string, unknown>) {
  const res = await authed().post('/api/providers').send(body);
  expect(res.status).to.equal(201);
  return res.body;
}

async function updateProvider(id: string, version: number, body: Record<string, unknown>) {
  const res = await authed().put(`/api/providers/${id}`).send({ version, ...body });
  expect(res.status).to.equal(200);
  return res.body;
}

async function deleteProvider(id: string, version: number) {
  const res = await authed().delete(`/api/providers/${id}`).send({ version });
  expect(res.status).to.equal(204);
  return res;
}

// The resolver's cache lives in the app-world singleton — resolve through the
// setup.ts seam (dual module graph: a test-side container.resolve would be a
// different instance than the one ProviderService invalidates).
async function chainIds(providerId: string): Promise<string[]> {
  const chain = await (globalThis as any).__TEST_FALLBACK_RESOLVER__.resolveChain(providerId);
  return chain.map((step: { provider: { id: string } }) => step.provider.id);
}

describe('Provider fallbacks (P3-02, e2e)', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  describe('create with fallbacks', () => {
    it('stores the ordered chain with settings and returns it in create/get/list', async () => {
      const b = await createProvider(llmProvider({ id: 'fb_b', name: 'B' }));
      const c = await createProvider(llmProvider({ id: 'fb_c', name: 'C' }));

      const created = await createProvider(
        llmProvider({
          id: 'fb_a',
          name: 'A',
          fallbacks: [
            { providerId: b.id, settings: { model: 'fallback-model-x' } },
            { providerId: c.id },
          ],
        }),
      );

      expect(created.fallbacks).to.have.length(2);
      expect(created.fallbacks.map((f: { providerId: string }) => f.providerId)).to.deep.equal([b.id, c.id]);
      expect(created.fallbacks[0].settings).to.deep.equal({ model: 'fallback-model-x' });
      expect(created.fallbacks[1].settings ?? null).to.equal(null);

      const got = await authed().get(`/api/providers/${created.id}`);
      expect(got.status).to.equal(200);
      expect(got.body.fallbacks.map((f: { providerId: string }) => f.providerId)).to.deep.equal([b.id, c.id]);
      expect(got.body.fallbacks[0].settings).to.deep.equal({ model: 'fallback-model-x' });

      const list = await authed().get('/api/providers');
      expect(list.status).to.equal(200);
      const item = list.body.items.find((p: { id: string }) => p.id === created.id);
      expect(item.fallbacks).to.have.length(2);
      expect(item.fallbacks[0].providerId).to.equal(b.id);
    });

    it('defaults to an empty chain when fallbacks is omitted', async () => {
      const created = await createProvider(llmProvider({ id: 'fb_default' }));
      expect(created.fallbacks).to.deep.equal([]);
    });
  });

  describe('validation (400s)', () => {
    it('rejects a missing fallback target', async () => {
      await createProvider(llmProvider({ id: 'fb_a' }));
      const res = await authed().post('/api/providers').send(llmProvider({ id: 'fb_new', fallbacks: [{ providerId: 'prov_ghost' }] }));
      expect(res.status).to.equal(400);
      expect(JSON.stringify(res.body)).to.match(/prov_ghost/);
    });

    it('rejects a providerType mismatch', async () => {
      const storage = await createProvider({
        name: 'S',
        providerType: 'storage',
        apiType: 'local',
        config: { basePath: '/tmp/fb-storage' },
      });
      const res = await authed().post('/api/providers').send(llmProvider({ id: 'fb_a', fallbacks: [{ providerId: storage.id }] }));
      expect(res.status).to.equal(400);
      expect(JSON.stringify(res.body)).to.match(/storage/);
    });

    it('rejects a self-reference (create and update)', async () => {
      const onCreate = await authed().post('/api/providers').send(llmProvider({ id: 'fb_self', fallbacks: [{ providerId: 'fb_self' }] }));
      expect(onCreate.status).to.equal(400);
      expect(JSON.stringify(onCreate.body)).to.match(/itself/);

      const a = await createProvider(llmProvider({ id: 'fb_self2' }));
      const onUpdate = await authed().put(`/api/providers/${a.id}`).send({ version: 1, fallbacks: [{ providerId: a.id }] });
      expect(onUpdate.status).to.equal(400);
      expect(JSON.stringify(onUpdate.body)).to.match(/itself/);
    });

    it('rejects duplicates in the list', async () => {
      const b = await createProvider(llmProvider({ id: 'fb_b' }));
      const res = await authed().post('/api/providers').send(llmProvider({ id: 'fb_a', fallbacks: [{ providerId: b.id }, { providerId: b.id }] }));
      expect(res.status).to.equal(400);
      expect(JSON.stringify(res.body)).to.match(/Duplicate/);
    });

    it('rejects a 2-cycle (A→B then B→A)', async () => {
      const a = await createProvider(llmProvider({ id: 'fb_a' }));
      const b = await createProvider(llmProvider({ id: 'fb_b' }));
      await updateProvider(a.id, 1, { fallbacks: [{ providerId: b.id }] });
      const res = await authed().put(`/api/providers/${b.id}`).send({ version: 1, fallbacks: [{ providerId: a.id }] });
      expect(res.status).to.equal(400);
      expect(JSON.stringify(res.body)).to.match(/Cycle/);
    });

    it('rejects a 3-cycle (A→B, B→C, then C→A)', async () => {
      const a = await createProvider(llmProvider({ id: 'fb_a' }));
      const b = await createProvider(llmProvider({ id: 'fb_b' }));
      const c = await createProvider(llmProvider({ id: 'fb_c' }));
      await updateProvider(a.id, 1, { fallbacks: [{ providerId: b.id }] });
      await updateProvider(b.id, 1, { fallbacks: [{ providerId: c.id }] });
      const res = await authed().put(`/api/providers/${c.id}`).send({ version: 1, fallbacks: [{ providerId: a.id }] });
      expect(res.status).to.equal(400);
      expect(JSON.stringify(res.body)).to.match(/Cycle/);
    });

    it('rejects more than 3 fallbacks (Zod max)', async () => {
      const ids = ['fb_b', 'fb_c', 'fb_d', 'fb_e'];
      for (const id of ids) {
        await createProvider(llmProvider({ id }));
      }
      const res = await authed()
        .post('/api/providers')
        .send(llmProvider({ id: 'fb_a', fallbacks: ids.map((providerId) => ({ providerId })) }));
      expect(res.status).to.equal(400);
    });
  });

  describe('FallbackResolver', () => {
    it('resolves the exact chain and reflects updates without restart (cache invalidation)', async () => {
      const b = await createProvider(llmProvider({ id: 'fb_b' }));
      const c = await createProvider(llmProvider({ id: 'fb_c' }));
      const a = await createProvider(llmProvider({ id: 'fb_a', fallbacks: [{ providerId: b.id, settings: { model: 'm-1' } }] }));

      expect(await chainIds(a.id)).to.deep.equal([a.id, b.id]);

      const updated = await updateProvider(a.id, a.version, { fallbacks: [{ providerId: c.id }] });
      expect(await chainIds(updated.id)).to.deep.equal([updated.id, c.id]);

      await updateProvider(updated.id, updated.version, { fallbacks: [] });
      expect(await chainIds(updated.id)).to.deep.equal([updated.id]);
    });

    it('drops a deleted fallback target from the chain', async () => {
      const b = await createProvider(llmProvider({ id: 'fb_b' }));
      const a = await createProvider(llmProvider({ id: 'fb_a', fallbacks: [{ providerId: b.id }] }));
      expect(await chainIds(a.id)).to.deep.equal([a.id, b.id]);

      await deleteProvider(b.id, b.version);
      expect(await chainIds(a.id)).to.deep.equal([a.id]);
    });

    it('returns an empty chain for an unknown provider', async () => {
      expect(await chainIds('prov_ghost')).to.deep.equal([]);
    });
  });

  describe('FallbackEventService', () => {
    it('records a fallback event (success=false) and markSucceeded flips it', async () => {
      const service = container.resolve(FallbackEventService);

      const event = await service.record({
        providerId: 'prov_a',
        fallbackProviderId: 'prov_b',
        providerType: 'llm',
        operation: 'llm.generate',
        reason: 'rate_limited',
        projectId: 'proj_x',
        conversationId: 'conv_y',
      });
      expect(event).to.not.equal(null);

      let rows = await db.select().from(fallbackEvents).where(eq(fallbackEvents.id, event!.id));
      expect(rows).to.have.length(1);
      expect(rows[0].providerId).to.equal('prov_a');
      expect(rows[0].fallbackProviderId).to.equal('prov_b');
      expect(rows[0].operation).to.equal('llm.generate');
      expect(rows[0].reason).to.equal('rate_limited');
      expect(rows[0].projectId).to.equal('proj_x');
      expect(rows[0].conversationId).to.equal('conv_y');
      expect(rows[0].success).to.equal(false);
      expect(rows[0].id).to.match(/^fbev_/);

      await service.markSucceeded(event!.id);
      rows = await db.select().from(fallbackEvents).where(eq(fallbackEvents.id, event!.id));
      expect(rows[0].success).to.equal(true);
    });
  });
});
