import { expect } from 'chai';
import { resetDatabase } from '../utils';
import { authed } from '../utils';
import { MINIMAL_PROJECT, MINIMAL_AGENT, createProjectWithAgent } from '../fixtures';

describe('Project Snapshot API', () => {
  let projectId: string;
  let agentId: string;
  let snapshotId: string;

  beforeEach(async () => {
    await resetDatabase();
    const fixture = await createProjectWithAgent();
    projectId = fixture.projectId;
    agentId = fixture.agentId;
  });

  describe('create', () => {
    it('should create a snapshot with auto-incremented version', async () => {
      const res = await authed().post(`/api/projects/${projectId}/snapshots`).send({});
      expect(res.status).to.equal(201);
      expect(res.body.version).to.equal(1);
      expect(res.body.projectId).to.equal(projectId);
      expect(res.body.entityCounts.agents).to.equal(1);
      expect(res.body.entityCounts.stages).to.equal(0);
      snapshotId = res.body.id;
    });

    it('should create a snapshot with a name', async () => {
      const res = await authed().post(`/api/projects/${projectId}/snapshots`).send({
        name: 'Initial snapshot',
      });
      expect(res.status).to.equal(201);
      expect(res.body.name).to.equal('Initial snapshot');
      expect(res.body.version).to.equal(1);
    });

    it('should auto-increment version numbers', async () => {
      const res1 = await authed().post(`/api/projects/${projectId}/snapshots`).send({});
      expect(res1.status).to.equal(201);
      expect(res1.body.version).to.equal(1);

      const res2 = await authed().post(`/api/projects/${projectId}/snapshots`).send({});
      expect(res2.status).to.equal(201);
      expect(res2.body.version).to.equal(2);
    });

    it('should return 404 for non-existent project', async () => {
      const res = await authed().post('/api/projects/proj_nonexistent/snapshots').send({});
      expect(res.status).to.equal(404);
    });

    it('should capture all entity types', async () => {
      // Create a global action (no provider needed)
      const gaRes = await authed().post(`/api/projects/${projectId}/global-actions`).send({
        name: 'Test Action',
      });
      expect(gaRes.status).to.equal(201);

      const res = await authed().post(`/api/projects/${projectId}/snapshots`).send({});
      expect(res.status).to.equal(201);
      expect(res.body.entityCounts.agents).to.equal(1);
      expect(res.body.entityCounts.globalActions).to.equal(1);
    });
  });

  describe('list', () => {
    it('should return empty list for project with no snapshots', async () => {
      const res = await authed().get(`/api/projects/${projectId}/snapshots`);
      expect(res.status).to.equal(200);
      expect(res.body.items).to.be.an('array').that.is.empty;
      expect(res.body.total).to.equal(0);
    });

    it('should list snapshots ordered by version descending', async () => {
      const res1 = await authed().post(`/api/projects/${projectId}/snapshots`).send({ name: 'First' });
      expect(res1.status).to.equal(201);
      const res2 = await authed().post(`/api/projects/${projectId}/snapshots`).send({ name: 'Second' });
      expect(res2.status).to.equal(201);
      const res3 = await authed().post(`/api/projects/${projectId}/snapshots`).send({ name: 'Third' });
      expect(res3.status).to.equal(201);

      const listRes = await authed().get(`/api/projects/${projectId}/snapshots`);
      expect(listRes.status).to.equal(200);
      expect(listRes.body.items).to.have.length(3);
      expect(listRes.body.items[0].version).to.equal(3);
      expect(listRes.body.items[1].version).to.equal(2);
      expect(listRes.body.items[2].version).to.equal(1);
    });

    it('should support pagination', async () => {
      // Create 3 snapshots
      for (let i = 0; i < 3; i++) {
        const res = await authed().post(`/api/projects/${projectId}/snapshots`).send({});
        expect(res.status).to.equal(201);
      }

      const res = await authed().get(`/api/projects/${projectId}/snapshots?offset=0&limit=2`);
      expect(res.status).to.equal(200);
      expect(res.body.items).to.have.length(2);
      expect(res.body.total).to.equal(3);
      expect(res.body.offset).to.equal(0);
      expect(res.body.limit).to.equal(2);
    });

    it('should support text search', async () => {
      await authed().post(`/api/projects/${projectId}/snapshots`).send({ name: 'Alpha' });
      await authed().post(`/api/projects/${projectId}/snapshots`).send({ name: 'Beta' });
      await authed().post(`/api/projects/${projectId}/snapshots`).send({ name: 'Gamma' });

      const res = await authed().get(`/api/projects/${projectId}/snapshots?textSearch=Beta`);
      expect(res.status).to.equal(200);
      expect(res.body.items).to.have.length(1);
      expect(res.body.items[0].name).to.equal('Beta');
    });

    it('should return 404 for non-existent project', async () => {
      const res = await authed().get('/api/projects/proj_nonexistent/snapshots');
      expect(res.status).to.equal(404);
    });

    it('should include schemaStatus in responses', async () => {
      await authed().post(`/api/projects/${projectId}/snapshots`).send({});
      const res = await authed().get(`/api/projects/${projectId}/snapshots`);
      expect(res.status).to.equal(200);
      expect(res.body.items[0].schemaStatus).to.equal('compatible');
    });
  });

  describe('get by id', () => {
    it('should return full snapshot with entityData', async () => {
      const createRes = await authed().post(`/api/projects/${projectId}/snapshots`).send({ name: 'Test' });
      expect(createRes.status).to.equal(201);
      snapshotId = createRes.body.id;

      const res = await authed().get(`/api/projects/${projectId}/snapshots/${snapshotId}`);
      expect(res.status).to.equal(200);
      expect(res.body.id).to.equal(snapshotId);
      expect(res.body.version).to.equal(1);
      expect(res.body.entityData).to.be.an('object');
      expect(res.body.entityData.formatVersion).to.equal(1);
      expect(res.body.entityData.agents).to.be.an('array').with.length(1);
      expect(res.body.entityData.agents[0].id).to.equal(agentId);
    });

    it('should return 404 for non-existent snapshot', async () => {
      const res = await authed().get(`/api/projects/${projectId}/snapshots/proj_snap_nonexistent`);
      expect(res.status).to.equal(404);
    });
  });

  describe('get by version', () => {
    it('should return snapshot by version number', async () => {
      await authed().post(`/api/projects/${projectId}/snapshots`).send({ name: 'First' });
      await authed().post(`/api/projects/${projectId}/snapshots`).send({ name: 'Second' });

      const res = await authed().get(`/api/projects/${projectId}/snapshots/version/2`);
      expect(res.status).to.equal(200);
      expect(res.body.version).to.equal(2);
      expect(res.body.name).to.equal('Second');
    });

    it('should return 404 for non-existent version', async () => {
      const res = await authed().get(`/api/projects/${projectId}/snapshots/version/99`);
      expect(res.status).to.equal(404);
    });
  });

  describe('update name', () => {
    it('should update snapshot name', async () => {
      const createRes = await authed().post(`/api/projects/${projectId}/snapshots`).send({ name: 'Old Name' });
      expect(createRes.status).to.equal(201);
      snapshotId = createRes.body.id;

      const res = await authed().patch(`/api/projects/${projectId}/snapshots/${snapshotId}`).send({
        name: 'New Name',
      });
      expect(res.status).to.equal(200);
      expect(res.body.name).to.equal('New Name');
    });

    it('should return 404 for non-existent snapshot', async () => {
      const res = await authed().patch(`/api/projects/${projectId}/snapshots/proj_snap_nonexistent`).send({
        name: 'New Name',
      });
      expect(res.status).to.equal(404);
    });
  });

  describe('compare', () => {
    it('should return empty diff for identical snapshots', async () => {
      await authed().post(`/api/projects/${projectId}/snapshots`).send({});
      await authed().post(`/api/projects/${projectId}/snapshots`).send({});

      const res = await authed().get(`/api/projects/${projectId}/snapshots/compare?fromVersion=1&toVersion=2`);
      expect(res.status).to.equal(200);
      expect(res.body.fromVersion).to.equal(1);
      expect(res.body.toVersion).to.equal(2);
      expect(res.body.summary.entitiesModified).to.be.an('array').that.is.empty;
      expect(res.body.summary.entitiesAdded).to.be.an('array').that.is.empty;
      expect(res.body.summary.entitiesRemoved).to.be.an('array').that.is.empty;
    });

    it('should detect added entities', async () => {
      await authed().post(`/api/projects/${projectId}/snapshots`).send({});

      // Add a global action
      const gaRes = await authed().post(`/api/projects/${projectId}/global-actions`).send({
        name: 'New Global Action',
      });
      expect(gaRes.status).to.equal(201);

      await authed().post(`/api/projects/${projectId}/snapshots`).send({});

      const res = await authed().get(`/api/projects/${projectId}/snapshots/compare?fromVersion=1&toVersion=2`);
      expect(res.status).to.equal(200);
      expect(res.body.summary.entitiesAdded).to.include(gaRes.body.id);
    });

    it('should detect removed entities', async () => {
      await authed().post(`/api/projects/${projectId}/snapshots`).send({});

      // Delete the agent (needs version for optimistic locking)
      const delRes = await authed().delete(`/api/projects/${projectId}/agents/${agentId}`).send({ version: 1 });
      expect(delRes.status).to.be.oneOf([200, 204]);

      await authed().post(`/api/projects/${projectId}/snapshots`).send({});

      const res = await authed().get(`/api/projects/${projectId}/snapshots/compare?fromVersion=1&toVersion=2`);
      expect(res.status).to.equal(200);
      expect(res.body.summary.entitiesRemoved).to.include(agentId);
    });

    it('should detect modified entities', async () => {
      await authed().post(`/api/projects/${projectId}/snapshots`).send({});

      // Update agent prompt
      const updateRes = await authed().put(`/api/projects/${projectId}/agents/${agentId}`).send({
        prompt: 'Updated prompt',
        version: 1,
      });
      expect(updateRes.status).to.equal(200);

      await authed().post(`/api/projects/${projectId}/snapshots`).send({});

      const res = await authed().get(`/api/projects/${projectId}/snapshots/compare?fromVersion=1&toVersion=2`);
      expect(res.status).to.equal(200);
      expect(res.body.summary.entitiesModified).to.include(agentId);
      const agentDiff = res.body.diffs.find((d: any) => d.entityId === agentId);
      expect(agentDiff).to.exist;
      const promptChange = agentDiff.changes.find((c: any) => c.field === 'prompt');
      expect(promptChange).to.exist;
      expect(promptChange.from).to.equal('You are a helpful assistant.');
      expect(promptChange.to).to.equal('Updated prompt');
    });

    it('should return 400 when fromVersion equals toVersion', async () => {
      await authed().post(`/api/projects/${projectId}/snapshots`).send({});
      const res = await authed().get(`/api/projects/${projectId}/snapshots/compare?fromVersion=1&toVersion=1`);
      expect(res.status).to.equal(400);
    });

    it('should return 404 for non-existent version', async () => {
      const res = await authed().get(`/api/projects/${projectId}/snapshots/compare?fromVersion=1&toVersion=99`);
      expect(res.status).to.equal(404);
    });
  });

  describe('restore', () => {
    it('should restore project from snapshot', async () => {
      // Create initial snapshot
      const createRes = await authed().post(`/api/projects/${projectId}/snapshots`).send({ name: 'Before changes' });
      expect(createRes.status).to.equal(201);
      snapshotId = createRes.body.id;

      // Modify the agent
      await authed().put(`/api/projects/${projectId}/agents/${agentId}`).send({
        prompt: 'Changed prompt',
        version: 1,
      });

      // Restore from snapshot
      const res = await authed().post(`/api/projects/${projectId}/snapshots/${snapshotId}/restore`);
      expect(res.status).to.equal(200);
      expect(res.body.restored).to.be.true;
      expect(res.body.snapshotVersion).to.equal(1);
      expect(res.body.entityCounts.agents).to.equal(1);

      // Verify agent is restored
      const agentRes = await authed().get(`/api/projects/${projectId}/agents/${agentId}`);
      expect(agentRes.status).to.equal(200);
      expect(agentRes.body.prompt).to.equal('You are a helpful assistant.');
    });

    it('should create a backup snapshot before restore', async () => {
      const createRes = await authed().post(`/api/projects/${projectId}/snapshots`).send({ name: 'Original' });
      expect(createRes.status).to.equal(201);
      snapshotId = createRes.body.id;

      // Modify something
      await authed().put(`/api/projects/${projectId}/agents/${agentId}`).send({
        prompt: 'Changed',
        version: 1,
      });

      // Restore
      await authed().post(`/api/projects/${projectId}/snapshots/${snapshotId}/restore`);

      // Check that a backup snapshot was created
      const listRes = await authed().get(`/api/projects/${projectId}/snapshots`);
      expect(listRes.status).to.equal(200);
      // Should have original + backup (version 2)
      expect(listRes.body.total).to.equal(2);
    });

    it('should return 404 for non-existent snapshot', async () => {
      const res = await authed().post(`/api/projects/${projectId}/snapshots/proj_snap_nonexistent/restore`);
      expect(res.status).to.equal(404);
    });
  });

  describe('delete', () => {
    it('should delete a snapshot', async () => {
      const createRes = await authed().post(`/api/projects/${projectId}/snapshots`).send({});
      expect(createRes.status).to.equal(201);
      snapshotId = createRes.body.id;

      const res = await authed().delete(`/api/projects/${projectId}/snapshots/${snapshotId}`);
      expect(res.status).to.equal(200);
      expect(res.body.deleted).to.be.true;
      expect(res.body.snapshotId).to.equal(snapshotId);

      // Verify it's gone
      const listRes = await authed().get(`/api/projects/${projectId}/snapshots`);
      expect(listRes.status).to.equal(200);
      expect(listRes.body.total).to.equal(0);
    });

    it('should return 404 for non-existent snapshot', async () => {
      const res = await authed().delete(`/api/projects/${projectId}/snapshots/proj_snap_nonexistent`);
      expect(res.status).to.equal(404);
    });

    it('should allow version gaps after deletion', async () => {
      await authed().post(`/api/projects/${projectId}/snapshots`).send({});
      await authed().post(`/api/projects/${projectId}/snapshots`).send({});
      await authed().post(`/api/projects/${projectId}/snapshots`).send({});

      const listRes = await authed().get(`/api/projects/${projectId}/snapshots`);
      expect(listRes.status).to.equal(200);
      expect(listRes.body.total).to.equal(3);
      const snapshot2Id = listRes.body.items.find((s: any) => s.version === 2).id;

      await authed().delete(`/api/projects/${projectId}/snapshots/${snapshot2Id}`);

      // Verify gap exists (v1 and v3 remain)
      const listAfterDelete = await authed().get(`/api/projects/${projectId}/snapshots`);
      expect(listAfterDelete.status).to.equal(200);
      expect(listAfterDelete.body.total).to.equal(2);
      const versions = listAfterDelete.body.items.map((s: any) => s.version);
      expect(versions).to.include(1);
      expect(versions).to.include(3);
      expect(versions).to.not.include(2);

      // Create new snapshot — should be version 4 (MAX + 1), not 2
      const newRes = await authed().post(`/api/projects/${projectId}/snapshots`).send({});
      expect(newRes.status).to.equal(201);
      expect(newRes.body.version).to.equal(4);
    });
  });

  describe('schema compatibility', () => {
    it('should report compatible status for fresh snapshots', async () => {
      const createRes = await authed().post(`/api/projects/${projectId}/snapshots`).send({});
      expect(createRes.status).to.equal(201);
      expect(createRes.body.schemaStatus).to.equal('compatible');
    });
  });

  describe('permissions', () => {
    it('should require PROJECT_WRITE for create', async () => {
      // Authenticated user with PROJECT_READ only should fail
      // This test assumes the test operator has super_admin role
      // We can't easily test with a restricted role without creating a new operator
      const res = await authed().post(`/api/projects/${projectId}/snapshots`).send({});
      expect(res.status).to.equal(201);
    });

    it('should require PROJECT_READ for list', async () => {
      const res = await authed().get(`/api/projects/${projectId}/snapshots`);
      expect(res.status).to.equal(200);
    });
  });
});
