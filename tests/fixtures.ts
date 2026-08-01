import request from 'supertest';
import { authed } from './utils';

// ── Shared minimal payloads ──────────────────────────────────────────
export const MINIMAL_PROJECT = {
  name: 'Test Project',
  acceptVoice: false,
  generateVoice: false,
  sampleCopyConfig: {},
  recordingConfig: { enabled: false },
};

export const MINIMAL_AGENT = {
  name: 'Test Agent',
  prompt: 'You are a helpful assistant.',
};

// ── Fixture factory ──────────────────────────────────────────────────
export interface FixtureContext {
  projectId: string;
  agentId: string;
}

export async function createProjectWithAgent(): Promise<FixtureContext> {
  const projectRes = await authed().post('/api/projects').send(MINIMAL_PROJECT);
  const agentRes = await authed()
    .post(`/api/projects/${projectRes.body.id}/agents`)
    .send(MINIMAL_AGENT);
  return { projectId: projectRes.body.id, agentId: agentRes.body.id };
}
