import 'reflect-metadata';
import { container } from 'tsyringe';
import { db } from '../../../src/db';
import { conversations, users } from '../../../src/db/schema';
import { eq } from 'drizzle-orm';
import { generateId, ID_PREFIXES } from '../../../src/utils/idGenerator';
import { ConversationRunner } from '../../../src/services/live/ConversationRunner';
import type { Session } from '../../../src/channels/SessionManager';
import type { IClientConnection } from '../../../src/channels/IClientConnection';
import { LlmProviderFactory } from '../../../src/services/providers/llm/LlmProviderFactory';
import type { LlmSettings } from '../../../src/services/providers/llm/LlmProviderFactory';
import { MockLlmProvider } from './mockLlmProvider';
import { EventCollectorClientConnection } from './eventCollectorClientConnection';
import type { ApiKeyChannel } from '../../../src/apiKeyFeatures';
import type { CALOutputMessage } from '../../../src/channels/messages';
import request from 'supertest';
import { authed, resetDatabase } from '../../utils';
import { MINIMAL_PROJECT, MINIMAL_AGENT } from '../../fixtures';

/** Stage configuration for test setup. */
export type StageConfig = {
  name: string;
  prompt: string;
  llmSettings: LlmSettings;
  actions?: Record<string, any>;
  useKnowledge?: boolean;
  knowledgeTags?: string[];
};

/**
 * Reusable test harness for conversation runner integration tests.
 *
 * Usage:
 *   const harness = new ConversationTestHarness();
 *   await harness.setup({ llmSettings: { provider: 'openai', model: 'gpt-4', temperature: 0.7 } });
 *   harness.mockLlm.queueResponse('Hello!');
 *   await harness.start();
 *   harness.assertEvent('conversation_start');
 *   await harness.teardown();
 */
export class ConversationTestHarness {
  public mockLlm: MockLlmProvider;
  public events: EventCollectorClientConnection;
  public runner: ConversationRunner | null = null;
  public projectId!: string;
  public agentId!: string;
  public stageId!: string;
  public conversationId!: string;
  public session!: Session;
  public _providerId!: string;

  constructor() {
    this.mockLlm = new MockLlmProvider();
    this.events = new EventCollectorClientConnection();
  }

  /**
   * Set up a complete test environment: reset DB, create project/agent/provider/stage,
   * create conversation, override IoC container, and resolve ConversationRunner.
   */
  async setup(stageConfig: StageConfig): Promise<this> {
    await resetDatabase();

    // Create project
    const projectRes = await authed().post('/api/projects').send(MINIMAL_PROJECT);
    this.projectId = projectRes.body.id;

    // Create agent
    const agentRes = await authed()
      .post(`/api/projects/${this.projectId}/agents`)
      .send(MINIMAL_AGENT);
    this.agentId = agentRes.body.id;

    // Create mock LLM provider (OpenAI-compatible)
    const providerRes = await authed()
      .post(`/api/providers`)
      .send({
        name: 'Mock LLM',
        providerType: 'llm',
        apiType: 'openai',
        config: {
          apiKey: 'sk-mock-key',
          baseUrl: 'https://mock.openai.com/v1',
        },
      });
    if (!providerRes.body || !providerRes.body.id) {
      throw new Error(`Provider creation failed: ${providerRes.status} - ${JSON.stringify(providerRes.body)}`);
    }
    this._providerId = providerRes.body.id;

    // Create stage
    const stagePayload: any = {
      name: stageConfig.name,
      prompt: stageConfig.prompt,
      llmProviderId: this._providerId,
      llmSettings: stageConfig.llmSettings,
      agentId: this.agentId,
      actions: stageConfig.actions || {},
    };
    if (stageConfig.useKnowledge !== undefined) stagePayload.useKnowledge = stageConfig.useKnowledge;
    if (stageConfig.knowledgeTags) stagePayload.knowledgeTags = stageConfig.knowledgeTags;

    const stageRes = await authed()
      .post(`/api/projects/${this.projectId}/stages`)
      .send(stagePayload);
    if (!stageRes.body || !stageRes.body.id) {
      throw new Error(`Stage creation failed: ${stageRes.status} - ${JSON.stringify(stageRes.body)}`);
    }
    this.stageId = stageRes.body.id;

    // Create user record (required for conversation FK)
    await db.insert(users).values({
      id: 'test_user',
      projectId: this.projectId,
      profile: {},
      banned: false,
    });

    // Create conversation directly in DB
    this.conversationId = generateId(ID_PREFIXES.CONVERSATION);
    await db.insert(conversations).values({
      id: this.conversationId,
      projectId: this.projectId,
      userId: 'test_user',
      sessionId: `test_session_${this.conversationId}`,
      stageId: this.stageId,
      status: 'initialized',
      stageVars: {},
    });

    // Override LlmProviderFactory to return our mock
    this.overrideLlmProvider();

    // Build session
    this.session = this.buildSession();

    // Resolve runner
    this.runner = container.resolve(ConversationRunner);

    // Link runner to session (required for UserInputProcessor.processTextInput)
    this.session.runner = this.runner;

    return this;
  }

  /**
   * Prepare and start the conversation.
   */
  async start(): Promise<this> {
    if (!this.runner) throw new Error('Runner not initialized. Call setup() first.');
    await this.runner.prepareConversation(this.conversationId, this.session, this.events);
    await this.runner.startConversation();
    return this;
  }

  /**
   * Send user text input and return the last AI response.
   */
  async sendInput(text: string): Promise<string> {
    if (!this.runner) throw new Error('Runner not initialized. Call setup() and start() first.');
    await this.runner.receiveUserTextInput(text);
    return this.events.aiResponses[this.events.aiResponses.length - 1];
  }

  /**
   * Assert that a conversation event of the given type was emitted.
   */
  assertEvent(eventType: string): this {
    const events = this.events.getEventsByType(eventType);
    if (events.length === 0) {
      throw new Error(`Expected event '${eventType}' but found none. Got events: ${this.events.conversationEvents.map(e => e.eventType).join(', ')}`);
    }
    return this;
  }

  /**
   * Assert that a specific AI response text was emitted.
   */
  assertAiResponse(expected: string): this {
    if (!this.events.aiResponses.includes(expected)) {
      throw new Error(`Expected AI response '${expected}' but got: ${JSON.stringify(this.events.aiResponses)}`);
    }
    return this;
  }

  /**
   * Assert that a conversation event of the given type was NOT emitted.
   */
  assertNoEvent(eventType: string): this {
    const events = this.events.getEventsByType(eventType);
    if (events.length > 0) {
      throw new Error(`Expected no event '${eventType}' but found ${events.length}`);
    }
    return this;
  }

  /**
   * Assert that the conversation has a specific status in the DB.
   */
  async assertConversationStatus(expected: string): Promise<this> {
    const conv = await this.getConversation();
    if (!conv) throw new Error('Conversation not found');
    if (conv.status !== expected) {
      throw new Error(`Expected conversation status '${expected}' but got '${conv.status}'`);
    }
    return this;
  }

  /**
   * Re-prepare the conversation after stage data has changed.
   * This reloads stage data from DB into the runner's cache.
   */
  async rePrepare(): Promise<this> {
    if (!this.runner) throw new Error('Runner not initialized. Call setup() first.');
    await this.runner.prepareConversation(this.conversationId, this.session, this.events);
    return this;
  }

  /**
   * Create an additional stage (for multi-stage transition tests).
   */
  async addStage(config: StageConfig): Promise<string> {
    const stagePayload: any = {
      name: config.name,
      prompt: config.prompt,
      llmProviderId: this._providerId,
      llmSettings: config.llmSettings,
      agentId: this.agentId,
      actions: config.actions || {},
    };
    if (config.useKnowledge !== undefined) stagePayload.useKnowledge = config.useKnowledge;
    if (config.knowledgeTags) stagePayload.knowledgeTags = config.knowledgeTags;

    const stageRes = await authed()
      .post(`/api/projects/${this.projectId}/stages`)
      .send(stagePayload);
    return stageRes.body.id;
  }

  /**
   * Get the current conversation state from DB.
   */
  async getConversation() {
    return db.query.conversations.findFirst({
      where: eq(conversations.id, this.conversationId),
    });
  }

  /**
   * Get a variable from the conversation's stage vars.
   */
  async getVariable(varName: string): Promise<any> {
    const conv = await this.getConversation();
    if (!conv) return undefined;
    const stageVars = conv.stageVars as Record<string, Record<string, any>> | undefined;
    return stageVars?.[this.stageId]?.[varName];
  }

  /**
   * Teardown: cleanup runner and restore IoC container.
   */
  async teardown(): Promise<void> {
    if (this.runner) {
      await this.runner.cleanup();
      this.runner = null;
    }
    container.reset();
    this.mockLlm.reset();
    this.events.reset();
  }

  // ── Private helpers ──────────────────────────────────────────────

  private overrideLlmProvider(): void {
    container.register(LlmProviderFactory, {
      useValue: {
        createProvider: async () => this.mockLlm,
        createProviderForEnumeration: async () => this.mockLlm,
      },
    });
  }

  private buildSession(): Session {
    const conn: IClientConnection = {
      connectionType: 'testing' as ApiKeyChannel,
      sendMessage: async (_msg: CALOutputMessage) => { /* no-op fallback */ },
      close: async () => { /* no-op */ },
    };
    return {
      id: `session_test_${this.conversationId}`,
      projectId: this.projectId,
      conversationId: this.conversationId,
      runner: null,
      clientConnection: conn,
      sessionSettings: {},
      keySettings: null,
      simulatedChannelType: null,
    };
  }
}
