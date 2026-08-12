import 'reflect-metadata';
import { expect } from 'chai';
import { container } from 'tsyringe';
import { ConversationTestHarness } from './conversationTestHarness';
import { LlmProviderFactory } from '../../../src/services/providers/llm/LlmProviderFactory';
import { MockLlmProvider } from './mockLlmProvider';
import { EventCollectorClientConnection } from './eventCollectorClientConnection';
import { authed, resetDatabase } from '../../utils';
import { MINIMAL_PROJECT, MINIMAL_AGENT } from '../../fixtures';

describe('ConversationRunner', () => {
  let harness: ConversationTestHarness;

  beforeEach(async () => {
    harness = new ConversationTestHarness();
  });

  afterEach(async () => {
    await harness.teardown();
  });

  describe('conversation lifecycle', () => {
    it('starts conversation and emits conversation_start event', async () => {
      await harness.setup({
        name: 'Welcome',
        prompt: 'You are a helpful assistant.',
        llmSettings: { provider: 'openai', model: 'gpt-4', temperature: 0.7 },
        actions: {
          __on_enter: {
            name: 'On Enter',
            triggerOnUserInput: false,
            triggerOnClientCommand: false,
            parameters: [],
            effects: [
              { type: 'generate_response', responseMode: 'generated' },
            ],
          },
        },
      });

      harness.mockLlm.queueResponse('Welcome! How can I help you?');

      await harness.start();

      harness.assertEvent('conversation_start');
      expect(harness.events.aiResponses).to.include('Welcome! How can I help you?');
    });

    it('executes on_enter actions with variable modifications', async () => {
      await harness.setup({
        name: 'Welcome',
        prompt: 'You are a helpful assistant.',
        llmSettings: { provider: 'openai', model: 'gpt-4', temperature: 0.7 },
        actions: {
          __on_enter: {
            name: 'On Enter',
            triggerOnUserInput: false,
            triggerOnClientCommand: false,
            parameters: [],
            effects: [
              {
                type: 'modify_variables',
                modifications: [
                  { variableName: 'greeted', operation: 'set', value: true },
                ],
              },
              { type: 'generate_response', responseMode: 'generated' },
            ],
          },
        },
      });

      harness.mockLlm.queueResponse('Hello!');

      await harness.start();

      harness.assertEvent('conversation_start');
      expect(harness.events.aiResponses).to.include('Hello!');

      // Verify variable was persisted
      const greeted = await harness.getVariable('greeted');
      expect(greeted).to.equal(true);
    });

    it('emits message event with AI response', async () => {
      await harness.setup({
        name: 'Chat',
        prompt: 'You are a helpful assistant.',
        llmSettings: { provider: 'openai', model: 'gpt-4', temperature: 0.7 },
        actions: {
          __on_enter: {
            name: 'On Enter',
            triggerOnUserInput: false,
            triggerOnClientCommand: false,
            parameters: [],
            effects: [
              { type: 'generate_response', responseMode: 'generated' },
            ],
          },
        },
      });

      harness.mockLlm.queueResponse('Hello there!');

      await harness.start();

      harness.assertEvent('conversation_start');
      harness.assertEvent('message');
      expect(harness.events.aiResponses).to.include('Hello there!');
    });

    it('transitions to awaiting_user_input after response', async () => {
      await harness.setup({
        name: 'Chat',
        prompt: 'You are a helpful assistant.',
        llmSettings: { provider: 'openai', model: 'gpt-4', temperature: 0.7 },
        actions: {
          __on_enter: {
            name: 'On Enter',
            triggerOnUserInput: false,
            triggerOnClientCommand: false,
            parameters: [],
            effects: [
              { type: 'generate_response', responseMode: 'generated' },
            ],
          },
        },
      });

      harness.mockLlm.queueResponse('Ready!');

      await harness.start();

      await harness.assertConversationStatus('awaiting_user_input');
    });
  });

  describe('user input flow', () => {
    it('handles user text input and generates response', async () => {
      await harness.setup({
        name: 'Chat',
        prompt: 'You are a helpful assistant.',
        llmSettings: { provider: 'openai', model: 'gpt-4', temperature: 0.7 },
        actions: {
          __on_enter: {
            name: 'On Enter',
            triggerOnUserInput: false,
            triggerOnClientCommand: false,
            parameters: [],
            effects: [
              { type: 'generate_response', responseMode: 'generated' },
            ],
          },
          default: {
            name: 'Default',
            triggerOnUserInput: true,
            triggerOnClientCommand: false,
            parameters: [],
            effects: [
              { type: 'generate_response', responseMode: 'generated' },
            ],
          },
        },
      });

      harness.mockLlm.queueResponse('Welcome!');
      await harness.start();

      harness.mockLlm.queueResponse('That\'s interesting!');
      const response = await harness.sendInput('Hello there');

      expect(response).to.equal('That\'s interesting!');
    });

    it('executes triggerOnUserInput action without classifier', async () => {
      await harness.setup({
        name: 'Chat',
        prompt: 'You are a helpful assistant.',
        llmSettings: { provider: 'openai', model: 'gpt-4', temperature: 0.7 },
        actions: {
          __on_enter: {
            name: 'On Enter',
            triggerOnUserInput: false,
            triggerOnClientCommand: false,
            parameters: [],
            effects: [
              { type: 'generate_response', responseMode: 'generated' },
            ],
          },
          default: {
            name: 'Default',
            triggerOnUserInput: true,
            triggerOnClientCommand: false,
            parameters: [],
            effects: [
              { type: 'generate_response', responseMode: 'generated' },
            ],
          },
        },
      });

      harness.mockLlm.queueResponse('Welcome!');
      await harness.start();

      harness.mockLlm.queueResponse('Got it!');

      await harness.sendInput('test message');

      // Without a classifier, triggerOnUserInput actions execute directly
      // No classification event emitted, but execution_plan should be present
      harness.assertEvent('execution_plan');
      expect(harness.events.aiResponses).to.include('Got it!');
    });
  });

  describe('stage transitions', () => {
    it('transitions to another stage via go_to_stage effect', async () => {
      // Set up Stage A first to get project/agent/provider
      await harness.setup({
        name: 'Stage A',
        prompt: 'You are stage A.',
        llmSettings: { provider: 'openai', model: 'gpt-4', temperature: 0.7 },
        actions: {
          __on_enter: {
            name: 'On Enter A',
            triggerOnUserInput: false,
            triggerOnClientCommand: false,
            parameters: [],
            effects: [
              { type: 'generate_response', responseMode: 'generated' },
            ],
          },
        },
      });

      // Create Stage B (same DB session as Stage A)
      const stageBId = await harness.addStage({
        name: 'Stage B',
        prompt: 'You are stage B.',
        llmSettings: { provider: 'openai', model: 'gpt-4', temperature: 0.7 },
        actions: {
          __on_enter: {
            name: 'On Enter B',
            triggerOnUserInput: false,
            triggerOnClientCommand: false,
            parameters: [],
            effects: [
              { type: 'generate_response', responseMode: 'generated' },
            ],
          },
        },
      });

      // Now update Stage A to include goToB action referencing Stage B
      const stageA = await authed().get(`/api/projects/${harness.projectId}/stages/${harness.stageId}`);
      const putRes = await authed()
        .put(`/api/projects/${harness.projectId}/stages/${harness.stageId}`)
        .send({
          name: stageA.body.name,
          prompt: stageA.body.prompt,
          version: stageA.body.version,
          actions: {
            ...stageA.body.actions,
            goToB: {
              name: 'Go to B',
              triggerOnUserInput: true,
              triggerOnClientCommand: false,
              parameters: [],
              effects: [
                { type: 'go_to_stage', stageId: stageBId },
              ],
            },
          },
        });

      harness.mockLlm.queueResponse('Hello from A!');
      await harness.start();

      harness.assertEvent('conversation_start');
      expect(harness.events.aiResponses).to.include('Hello from A!');

      // Queue response for Stage B on_enter
      harness.mockLlm.queueResponse('Hello from B!');

      // Trigger transition via runAction
      await harness.runner!.runAction('goToB', {});

      harness.assertEvent('jump_to_stage');
      expect(harness.events.aiResponses).to.include('Hello from B!');
    });
  });

  describe('variable operations', () => {
    it('modifies variables via modify_variables effect', async () => {
      await harness.setup({
        name: 'Vars',
        prompt: 'You are a helpful assistant.',
        llmSettings: { provider: 'openai', model: 'gpt-4', temperature: 0.7 },
        actions: {
          __on_enter: {
            name: 'On Enter',
            triggerOnUserInput: false,
            triggerOnClientCommand: false,
            parameters: [],
            effects: [
              {
                type: 'modify_variables',
                modifications: [
                  { variableName: 'counter', operation: 'set', value: 0 },
                  { variableName: 'name', operation: 'set', value: 'Alice' },
                ],
              },
              { type: 'generate_response', responseMode: 'generated' },
            ],
          },
        },
      });

      harness.mockLlm.queueResponse('Variables set!');

      await harness.start();

      expect(await harness.getVariable('counter')).to.equal(0);
      expect(await harness.getVariable('name')).to.equal('Alice');
    });

    it('resets variables via modify_variables effect', async () => {
      await harness.setup({
        name: 'Vars',
        prompt: 'You are a helpful assistant.',
        llmSettings: { provider: 'openai', model: 'gpt-4', temperature: 0.7 },
        actions: {
          __on_enter: {
            name: 'On Enter',
            triggerOnUserInput: false,
            triggerOnClientCommand: false,
            parameters: [],
            effects: [
              {
                type: 'modify_variables',
                modifications: [
                  { variableName: 'counter', operation: 'set', value: 42 },
                  { variableName: 'counter', operation: 'reset', value: null },
                ],
              },
              { type: 'generate_response', responseMode: 'generated' },
            ],
          },
        },
      });

      harness.mockLlm.queueResponse('Reset done!');

      await harness.start();

      expect(await harness.getVariable('counter')).to.be.undefined;
    });

    it('adds to array variables via modify_variables effect', async () => {
      await harness.setup({
        name: 'Vars',
        prompt: 'You are a helpful assistant.',
        llmSettings: { provider: 'openai', model: 'gpt-4', temperature: 0.7 },
        actions: {
          __on_enter: {
            name: 'On Enter',
            triggerOnUserInput: false,
            triggerOnClientCommand: false,
            parameters: [],
            effects: [
              {
                type: 'modify_variables',
                modifications: [
                  { variableName: 'tags', operation: 'set', value: [] },
                  { variableName: 'tags', operation: 'add', value: 'hello' },
                  { variableName: 'tags', operation: 'add', value: 'world' },
                ],
              },
              { type: 'generate_response', responseMode: 'generated' },
            ],
          },
        },
      });

      harness.mockLlm.queueResponse('Tags added!');

      await harness.start();

      const tags = await harness.getVariable('tags');
      expect(tags).to.deep.equal(['hello', 'world']);
    });
  });

  describe('prescripted responses', () => {
    it('uses prescripted response without LLM call', async () => {
      await harness.setup({
        name: 'Prescripted',
        prompt: 'You are a helpful assistant.',
        llmSettings: { provider: 'openai', model: 'gpt-4', temperature: 0.7 },
        actions: {
          __on_enter: {
            name: 'On Enter',
            triggerOnUserInput: false,
            triggerOnClientCommand: false,
            parameters: [],
            effects: [
              {
                type: 'generate_response',
                responseMode: 'prescripted',
                prescriptedResponses: ['Hello from prescripted!', 'Alternative!'],
                prescriptedSelectionStrategy: 'random',
              },
            ],
          },
        },
      });

      await harness.start();

      // No LLM calls should be made for prescripted responses
      expect(harness.mockLlm.calls.length).to.equal(0);
      // Response should be one of the prescripted options
      expect(harness.events.aiResponses.length).to.be.greaterThan(0);
      expect(harness.events.aiResponses[0]).to.be.oneOf(['Hello from prescripted!', 'Alternative!']);
    });
  });

  describe('mock LLM assertions', () => {
    it('captures LLM calls for prompt verification', async () => {
      await harness.setup({
        name: 'Prompt Check',
        prompt: 'You are a pirate.',
        llmSettings: { provider: 'openai', model: 'gpt-4', temperature: 0.7 },
        actions: {
          __on_enter: {
            name: 'On Enter',
            triggerOnUserInput: false,
            triggerOnClientCommand: false,
            parameters: [],
            effects: [
              { type: 'generate_response', responseMode: 'generated' },
            ],
          },
        },
      });

      harness.mockLlm.queueResponse('Ahoy!');

      await harness.start();

      // Verify the system prompt was sent to the LLM
      expect(harness.mockLlm.calls.length).to.be.greaterThan(0);
      const lastCall = harness.mockLlm.calls[harness.mockLlm.calls.length - 1];
      const systemMsg = lastCall.find(m => m.role === 'system');
      expect(systemMsg).to.not.be.undefined;
      expect(systemMsg!.content).to.contain('pirate');
    });
  });

  describe('error handling', () => {
    it('handles missing stage gracefully', async () => {
      await harness.setup({
        name: 'Empty',
        prompt: 'You are empty.',
        llmSettings: { provider: 'openai', model: 'gpt-4', temperature: 0.7 },
        actions: {},
      });

      await harness.start();

      harness.assertEvent('conversation_start');
    });

    it('handles provider failure gracefully', async () => {
      // Set up with a mock that throws on generate
      harness.mockLlm = new MockLlmProvider();
      harness.mockLlm.queueResult({
        id: 'mock_fail',
        content: [],
        role: 'assistant',
        finishReason: 'error',
      });
      harness.events = new EventCollectorClientConnection();

      await harness.setup({
        name: 'Failing',
        prompt: 'You are failing.',
        llmSettings: { provider: 'openai', model: 'gpt-4', temperature: 0.7 },
        actions: {
          __on_enter: {
            name: 'On Enter',
            triggerOnUserInput: false,
            triggerOnClientCommand: false,
            parameters: [],
            effects: [
              { type: 'generate_response', responseMode: 'generated' },
            ],
          },
        },
      });

      await harness.start();

      // Conversation should start regardless of provider behavior
      harness.assertEvent('conversation_start');
    });
  });

  describe('abort conversation', () => {
    it('ends conversation via abort_conversation effect', async () => {
      await harness.setup({
        name: 'Abort',
        prompt: 'You are a helpful assistant.',
        llmSettings: { provider: 'openai', model: 'gpt-4', temperature: 0.7 },
        actions: {
          __on_enter: {
            name: 'On Enter',
            triggerOnUserInput: false,
            triggerOnClientCommand: false,
            parameters: [],
            effects: [
              { type: 'generate_response', responseMode: 'generated' },
            ],
          },
          abortNow: {
            name: 'Abort Now',
            triggerOnUserInput: true,
            triggerOnClientCommand: false,
            parameters: [],
            effects: [
              { type: 'abort_conversation' },
            ],
          },
        },
      });

      harness.mockLlm.queueResponse('Welcome!');
      await harness.start();

      harness.assertEvent('conversation_start');

      // Trigger abort via regular action (abort_conversation restricted in __on_enter)
      await harness.runner!.runAction('abortNow', {});
      // Execute the deferred terminal action
      await harness.runner!.executePendingTerminalAction();

      harness.assertEvent('conversation_aborted');
    });
  });

  describe('multi-turn conversations', () => {
    it('handles multiple user inputs with default action', async () => {
      await harness.setup({
        name: 'MultiTurn',
        prompt: 'You are a helpful assistant.',
        llmSettings: { provider: 'openai', model: 'gpt-4', temperature: 0.7 },
        actions: {
          __on_enter: {
            name: 'On Enter',
            triggerOnUserInput: false,
            triggerOnClientCommand: false,
            parameters: [],
            effects: [
              { type: 'generate_response', responseMode: 'generated' },
            ],
          },
          default: {
            name: 'Default',
            triggerOnUserInput: true,
            triggerOnClientCommand: false,
            parameters: [],
            effects: [
              { type: 'generate_response', responseMode: 'generated' },
            ],
          },
        },
      });

      harness.mockLlm.queueResponse('Welcome!');
      await harness.start();

      expect(harness.events.aiResponses).to.include('Welcome!');

      harness.mockLlm.queueResponse('Got your message!');
      const response = await harness.sendInput('hello');

      expect(response).to.equal('Got your message!');
      expect(harness.events.aiResponses).to.have.length(2);
    });
  });
});
