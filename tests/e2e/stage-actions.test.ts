import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { authed, resetDatabase } from '../utils';

// ── Fixtures ──────────────────────────────────────────────────────────
const MINIMAL_PROJECT = {
  name: 'Test Project',
  acceptVoice: false,
  generateVoice: false,
  sampleCopyConfig: {},
  recordingConfig: { enabled: false },
};

const MINIMAL_AGENT = {
  name: 'Test Agent',
  prompt: 'You are a helpful assistant.',
};

async function createProjectWithAgent() {
  const projectRes = await authed().post('/api/projects').send(MINIMAL_PROJECT);
  const agentRes = await authed()
    .post(`/api/projects/${projectRes.body.id}/agents`)
    .send(MINIMAL_AGENT);
  return { projectId: projectRes.body.id, agentId: agentRes.body.id };
}

function baseStagePayload(agentId: string) {
  return {
    name: 'Test Stage',
    prompt: 'You are a helpful stage.',
    llmProviderId: 'openai',
    llmSettings: { provider: 'openai', model: 'gpt-4', temperature: 0.7 },
    agentId,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────
describe('Stage Actions', () => {
  let projectId: string;
  let agentId: string;

  beforeEach(async () => {
    await resetDatabase();
    ({ projectId, agentId } = await createProjectWithAgent());
  });

  describe('basic action creation', () => {
    it('should create a stage with a single action', async () => {
      const res = await authed().post(`/api/projects/${projectId}/stages`).send({
        ...baseStagePayload(agentId),
        actions: {
          greet: {
            name: 'Greet User',
            triggerOnUserInput: true,
            triggerOnClientCommand: false,
            parameters: [],
            effects: [{ type: 'generate_response' }],
          },
        },
      });
      expect(res.status).to.equal(201);
      expect(res.body.actions.greet.name).to.equal('Greet User');
      expect(res.body.actions.greet.effects).to.have.length(1);
    });

    it('should create a stage with multiple actions', async () => {
      const res = await authed().post(`/api/projects/${projectId}/stages`).send({
        ...baseStagePayload(agentId),
        actions: {
          greet: {
            name: 'Greet',
            triggerOnUserInput: true,
            triggerOnClientCommand: false,
            parameters: [],
            effects: [{ type: 'generate_response' }],
          },
          goodbye: {
            name: 'Goodbye',
            triggerOnUserInput: true,
            triggerOnClientCommand: false,
            parameters: [],
            effects: [{ type: 'end_conversation', reason: 'user said goodbye' }],
          },
        },
      });
      expect(res.status).to.equal(201);
      expect(Object.keys(res.body.actions)).to.have.length(2);
      expect(res.body.actions.goodbye.effects[0].type).to.equal('end_conversation');
    });

    it('should create a stage with no actions (empty object)', async () => {
      const res = await authed().post(`/api/projects/${projectId}/stages`).send({
        ...baseStagePayload(agentId),
        actions: {},
      });
      expect(res.status).to.equal(201);
      expect(res.body.actions).to.deep.equal({});
    });

    it('should create a stage without actions field (defaults to empty)', async () => {
      const res = await authed().post(`/api/projects/${projectId}/stages`).send(baseStagePayload(agentId));
      expect(res.status).to.equal(201);
      expect(res.body.actions).to.deep.equal({});
    });
  });

  describe('action effects', () => {
    it('should support generate_response effect', async () => {
      const res = await authed().post(`/api/projects/${projectId}/stages`).send({
        ...baseStagePayload(agentId),
        actions: {
          reply: {
            name: 'Reply',
            triggerOnUserInput: true,
            triggerOnClientCommand: false,
            parameters: [],
            effects: [
              { type: 'generate_response', responseMode: 'generated' },
            ],
          },
        },
      });
      expect(res.status).to.equal(201);
      expect(res.body.actions.reply.effects[0].responseMode).to.equal('generated');
    });

    it('should support end_conversation effect', async () => {
      const res = await authed().post(`/api/projects/${projectId}/stages`).send({
        ...baseStagePayload(agentId),
        actions: {
          exit: {
            name: 'Exit',
            triggerOnUserInput: true,
            triggerOnClientCommand: false,
            parameters: [],
            effects: [{ type: 'end_conversation', reason: 'user wants to leave' }],
          },
        },
      });
      expect(res.status).to.equal(201);
      expect(res.body.actions.exit.effects[0].reason).to.equal('user wants to leave');
    });

    it('should support abort_conversation effect', async () => {
      const res = await authed().post(`/api/projects/${projectId}/stages`).send({
        ...baseStagePayload(agentId),
        actions: {
          abort: {
            name: 'Abort',
            triggerOnUserInput: true,
            triggerOnClientCommand: false,
            parameters: [],
            effects: [{ type: 'abort_conversation' }],
          },
        },
      });
      expect(res.status).to.equal(201);
      expect(res.body.actions.abort.effects[0].type).to.equal('abort_conversation');
    });

    it('should support go_to_stage effect', async () => {
      const res = await authed().post(`/api/projects/${projectId}/stages`).send({
        ...baseStagePayload(agentId),
        actions: {
          navigate: {
            name: 'Navigate',
            triggerOnUserInput: true,
            triggerOnClientCommand: false,
            parameters: [],
            effects: [{ type: 'go_to_stage', stageId: 'next-stage' }],
          },
        },
      });
      expect(res.status).to.equal(201);
      expect(res.body.actions.navigate.effects[0].stageId).to.equal('next-stage');
    });

    it('should support modify_user_input effect', async () => {
      const res = await authed().post(`/api/projects/${projectId}/stages`).send({
        ...baseStagePayload(agentId),
        actions: {
          rewrite: {
            name: 'Rewrite',
            triggerOnUserInput: true,
            triggerOnClientCommand: false,
            parameters: [],
            effects: [{ type: 'modify_user_input', template: 'Please help with: {{userInput}}' }],
          },
        },
      });
      expect(res.status).to.equal(201);
      expect(res.body.actions.rewrite.effects[0].template).to.equal('Please help with: {{userInput}}');
    });

    it('should support modify_variables effect', async () => {
      const res = await authed().post(`/api/projects/${projectId}/stages`).send({
        ...baseStagePayload(agentId),
        actions: {
          setVar: {
            name: 'Set Variable',
            triggerOnUserInput: true,
            triggerOnClientCommand: false,
            parameters: [],
            effects: [
              {
                type: 'modify_variables',
                modifications: [
                  { variableName: 'userName', operation: 'set', value: 'John' },
                  { variableName: 'counter', operation: 'add', value: 1 },
                ],
              },
            ],
          },
        },
      });
      expect(res.status).to.equal(201);
      expect(res.body.actions.setVar.effects[0].modifications).to.have.length(2);
    });

    it('should support modify_user_profile effect', async () => {
      const res = await authed().post(`/api/projects/${projectId}/stages`).send({
        ...baseStagePayload(agentId),
        actions: {
          updateProfile: {
            name: 'Update Profile',
            triggerOnUserInput: true,
            triggerOnClientCommand: false,
            parameters: [],
            effects: [
              {
                type: 'modify_user_profile',
                modifications: [
                  { fieldName: 'language', operation: 'set', value: 'en' },
                ],
              },
            ],
          },
        },
      });
      expect(res.status).to.equal(201);
      expect(res.body.actions.updateProfile.effects[0].type).to.equal('modify_user_profile');
    });

    it('should support call_tool effect', async () => {
      const res = await authed().post(`/api/projects/${projectId}/stages`).send({
        ...baseStagePayload(agentId),
        actions: {
          callTool: {
            name: 'Call Tool',
            triggerOnUserInput: true,
            triggerOnClientCommand: false,
            parameters: [],
            effects: [
              {
                type: 'call_tool',
                toolId: 'my-tool',
                parameters: { query: 'test' },
              },
            ],
          },
        },
      });
      expect(res.status).to.equal(201);
      expect(res.body.actions.callTool.effects[0].toolId).to.equal('my-tool');
    });

    it('should support change_visibility effect', async () => {
      const res = await authed().post(`/api/projects/${projectId}/stages`).send({
        ...baseStagePayload(agentId),
        actions: {
          hide: {
            name: 'Hide',
            triggerOnUserInput: true,
            triggerOnClientCommand: false,
            parameters: [],
            effects: [{ type: 'change_visibility', visibility: 'never' }],
          },
        },
      });
      expect(res.status).to.equal(201);
      expect(res.body.actions.hide.effects[0].visibility).to.equal('never');
    });

    it('should support ban_user effect', async () => {
      const res = await authed().post(`/api/projects/${projectId}/stages`).send({
        ...baseStagePayload(agentId),
        actions: {
          ban: {
            name: 'Ban',
            triggerOnUserInput: true,
            triggerOnClientCommand: false,
            parameters: [],
            effects: [{ type: 'ban_user', reason: 'spam' }],
          },
        },
      });
      expect(res.status).to.equal(201);
      expect(res.body.actions.ban.effects[0].reason).to.equal('spam');
    });

    it('should support save_artifact effect', async () => {
      const res = await authed().post(`/api/projects/${projectId}/stages`).send({
        ...baseStagePayload(agentId),
        actions: {
          save: {
            name: 'Save',
            triggerOnUserInput: true,
            triggerOnClientCommand: false,
            parameters: [],
            effects: [
              {
                type: 'save_artifact',
                data: 'hello',
                fileName: 'output.txt',
                variableName: 'artifactId',
              },
            ],
          },
        },
      });
      expect(res.status).to.equal(201);
      expect(res.body.actions.save.effects[0].variableName).to.equal('artifactId');
    });

    it('should support attach_file effect', async () => {
      const res = await authed().post(`/api/projects/${projectId}/stages`).send({
        ...baseStagePayload(agentId),
        actions: {
          attach: {
            name: 'Attach',
            triggerOnUserInput: true,
            triggerOnClientCommand: false,
            parameters: [],
            effects: [
              { type: 'attach_file', artifactId: 'artifact-123' },
            ],
          },
        },
      });
      expect(res.status).to.equal(201);
      expect(res.body.actions.attach.effects[0].artifactId).to.equal('artifact-123');
    });
  });

  describe('action parameters', () => {
    it('should create an action with parameters', async () => {
      const res = await authed().post(`/api/projects/${projectId}/stages`).send({
        ...baseStagePayload(agentId),
        actions: {
          bookFlight: {
            name: 'Book Flight',
            triggerOnUserInput: true,
            triggerOnClientCommand: false,
            parameters: [
              { name: 'destination', type: 'string', description: 'Flight destination', required: true },
              { name: 'date', type: 'string', description: 'Travel date', required: false },
            ],
            effects: [{ type: 'generate_response' }],
          },
        },
      });
      expect(res.status).to.equal(201);
      expect(res.body.actions.bookFlight.parameters).to.have.length(2);
      expect(res.body.actions.bookFlight.parameters[0].required).to.equal(true);
    });
  });

  describe('lifecycle actions', () => {
    it('should support __on_enter lifecycle action', async () => {
      const res = await authed().post(`/api/projects/${projectId}/stages`).send({
        ...baseStagePayload(agentId),
        actions: {
          __on_enter: {
            name: 'On Enter',
            triggerOnUserInput: false,
            triggerOnClientCommand: false,
            parameters: [],
            effects: [
              { type: 'modify_variables', modifications: [{ variableName: 'entered', operation: 'set', value: true }] },
            ],
          },
        },
      });
      expect(res.status).to.equal(201);
      expect(res.body.actions.__on_enter.name).to.equal('On Enter');
    });

    it('should support __on_leave lifecycle action', async () => {
      const res = await authed().post(`/api/projects/${projectId}/stages`).send({
        ...baseStagePayload(agentId),
        actions: {
          __on_leave: {
            name: 'On Leave',
            triggerOnUserInput: false,
            triggerOnClientCommand: false,
            parameters: [],
            effects: [
              { type: 'modify_variables', modifications: [{ variableName: 'exiting', operation: 'set', value: true }] },
            ],
          },
        },
      });
      expect(res.status).to.equal(201);
      expect(res.body.actions.__on_leave.name).to.equal('On Leave');
    });

    it('should support __on_fallback lifecycle action', async () => {
      const res = await authed().post(`/api/projects/${projectId}/stages`).send({
        ...baseStagePayload(agentId),
        actions: {
          __on_fallback: {
            name: 'Fallback',
            triggerOnUserInput: false,
            triggerOnClientCommand: false,
            parameters: [],
            effects: [
              { type: 'generate_response', responseMode: 'prescripted', prescriptedResponses: ["I'm not sure what you mean."] },
            ],
          },
        },
      });
      expect(res.status).to.equal(201);
      expect(res.body.actions.__on_fallback.effects[0].responseMode).to.equal('prescripted');
    });
  });

  describe('action triggers', () => {
    it('should support classificationTrigger', async () => {
      const res = await authed().post(`/api/projects/${projectId}/stages`).send({
        ...baseStagePayload(agentId),
        actions: {
          help: {
            name: 'Help',
            triggerOnUserInput: true,
            triggerOnClientCommand: false,
            classificationTrigger: 'user_needs_help',
            parameters: [],
            effects: [{ type: 'generate_response' }],
          },
        },
      });
      expect(res.status).to.equal(201);
      expect(res.body.actions.help.classificationTrigger).to.equal('user_needs_help');
    });

    it('should support triggerOnClientCommand', async () => {
      const res = await authed().post(`/api/projects/${projectId}/stages`).send({
        ...baseStagePayload(agentId),
        actions: {
          cmd: {
            name: 'Command',
            triggerOnUserInput: false,
            triggerOnClientCommand: true,
            parameters: [],
            effects: [{ type: 'generate_response' }],
          },
        },
      });
      expect(res.status).to.equal(201);
      expect(res.body.actions.cmd.triggerOnClientCommand).to.equal(true);
    });

    it('should support triggerOnExternal', async () => {
      const res = await authed().post(`/api/projects/${projectId}/stages`).send({
        ...baseStagePayload(agentId),
        actions: {
          external: {
            name: 'External',
            triggerOnUserInput: false,
            triggerOnClientCommand: false,
            triggerOnExternal: true,
            parameters: [],
            effects: [{ type: 'generate_response' }],
          },
        },
      });
      expect(res.status).to.equal(201);
      expect(res.body.actions.external.triggerOnExternal).to.equal(true);
    });

    it('should support watchedVariables', async () => {
      const res = await authed().post(`/api/projects/${projectId}/stages`).send({
        ...baseStagePayload(agentId),
        actions: {
          watch: {
            name: 'Watch',
            triggerOnUserInput: false,
            triggerOnClientCommand: false,
            triggerOnTransformation: true,
            watchedVariables: {
              'order.status': 'changed',
              'cart.items': 'any',
            },
            parameters: [],
            effects: [{ type: 'generate_response' }],
          },
        },
      });
      expect(res.status).to.equal(201);
      expect(res.body.actions.watch.watchedVariables['order.status']).to.equal('changed');
    });

    it('should support examples', async () => {
      const res = await authed().post(`/api/projects/${projectId}/stages`).send({
        ...baseStagePayload(agentId),
        actions: {
          order: {
            name: 'Order',
            triggerOnUserInput: true,
            triggerOnClientCommand: false,
            examples: ['I want to order', 'Place an order'],
            parameters: [],
            effects: [{ type: 'generate_response' }],
          },
        },
      });
      expect(res.status).to.equal(201);
      expect(res.body.actions.order.examples).to.have.length(2);
    });
  });

  describe('action updates', () => {
    it('should update actions on a stage', async () => {
      const createRes = await authed()
        .post(`/api/projects/${projectId}/stages`)
        .send(baseStagePayload(agentId));
      const { id, version } = createRes.body;

      const res = await authed().put(`/api/projects/${projectId}/stages/${id}`).send({
        version,
        actions: {
          newAction: {
            name: 'New Action',
            triggerOnUserInput: true,
            triggerOnClientCommand: false,
            parameters: [],
            effects: [{ type: 'generate_response' }],
          },
        },
      });
      expect(res.status).to.equal(200);
      expect(res.body.actions.newAction.name).to.equal('New Action');
    });

    it('should clear actions when set to empty object', async () => {
      const createRes = await authed()
        .post(`/api/projects/${projectId}/stages`)
        .send({
          ...baseStagePayload(agentId),
          actions: {
            greet: {
              name: 'Greet',
              triggerOnUserInput: true,
              triggerOnClientCommand: false,
              parameters: [],
              effects: [{ type: 'generate_response' }],
            },
          },
        });
      const { id, version } = createRes.body;

      const res = await authed().put(`/api/projects/${projectId}/stages/${id}`).send({
        version,
        actions: {},
      });
      expect(res.status).to.equal(200);
      expect(res.body.actions).to.deep.equal({});
    });
  });

  describe('action cloning', () => {
    it('should clone actions when cloning a stage', async () => {
      const createRes = await authed()
        .post(`/api/projects/${projectId}/stages`)
        .send({
          ...baseStagePayload(agentId),
          actions: {
            original: {
              name: 'Original',
              triggerOnUserInput: true,
              triggerOnClientCommand: false,
              parameters: [{ name: 'q', type: 'string', description: 'query', required: true }],
              effects: [{ type: 'generate_response' }],
            },
          },
        });
      const stageId = createRes.body.id;

      const cloneRes = await authed()
        .post(`/api/projects/${projectId}/stages/${stageId}/clone`)
        .send({ name: 'Cloned Stage' });
      expect(cloneRes.status).to.equal(201);
      expect(cloneRes.body.actions.original.name).to.equal('Original');
      expect(cloneRes.body.actions.original.parameters).to.have.length(1);
    });
  });
});
