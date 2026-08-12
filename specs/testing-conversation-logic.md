# Testing Live Conversation Logic — Proposal

## Current State

### What Exists
- **925 e2e HTTP tests** (Supertest + Mocha) — all 43 controllers covered for CRUD, auth, validation
- **Scenario Run System** (`src/services/testing/`) — LLM-backed automated tester personas that run real conversations via `TestRunner` → `ConversationRunner`
- **TesterClientConnection** — minimal `IClientConnection` mock that captures `end_ai_generation_output` and terminal events
- **ScenarioConversationEvaluator** — post-run evaluation of stage variables against expected values

### What's Missing
The **conversation runner pipeline** (`src/services/live/`, ~7710 lines) has **zero unit or integration test coverage**:

| Component | Lines | Coverage |
|---|---|---|
| `ConversationRunner.ts` | 3338 | 0% |
| `ActionsExecutor.ts` | 1065 | 0% |
| `ConversationContextBuilder.ts` | 1163 | 0% |
| `UserInputProcessor.ts` | 357 | 0% |
| `ToolExecutor.ts` | 264 | 0% |
| `IsolatedScriptExecutor.ts` | 284 | 0% |
| `TemplatingEngine.ts` | 278 | 0% |
| `ContextTransformerExecutor.ts` | 296 | 0% |
| Others | ~858 | 0% |

The Scenario Run system is the only existing test mechanism, but it has fundamental limitations:
- **Non-deterministic** — depends on real LLM output
- **Expensive** — every test burns LLM tokens
- **Slow** — real LLM latency per turn
- **Brittle** — can't test specific internal behaviors (action order, classification results, etc.)
- **Limited assertions** — `TesterClientConnection` only captures final AI text and terminal events

---

## Proposed Multi-Layered Testing Strategy

### Layer 1: Unit Tests (Isolated Components)

**Target**: Components that are pure functions or have easily mockable dependencies.

| Component | What to Test | Mock Needed |
|---|---|---|
| **TemplatingEngine** | Variable interpolation, conditional rendering, template errors | None (pure) |
| **ModifyVariablesEffectExecutor** | set/reset/add/remove operations, type handling | None (pure) |
| **ModifyUserProfileEffectExecutor** | Profile field mutations | None (pure) |
| **effectValueTransformer** | Value transformation logic | None (pure) |
| **SampleCopyDistributor** | Forced vs balanced distribution, exhaustion | None (pure) |
| **HistoryBuilder** | Visibility filtering (always/stage/never/conditional) | Mock IsolatedScriptExecutor |
| **ConversationRecorder** | Event recording logic | Minimal |
| **contextTruncation** | Token budget truncation, system message preservation | None (pure) |
| **UserInputProcessor** | Classification routing, action matching | Mock classifier |

**Implementation**: Standard Mocha + Chai tests in `tests/unit/live/`. No DB, no containers.

```typescript
// tests/unit/live/templatingEngine.test.ts
describe('TemplatingEngine', () => {
  it('interpolates variables from context', () => {
    const engine = new TemplatingEngine();
    const result = engine.render('Hello {{user.name}}', { user: { name: 'Alice' } });
    expect(result).to.equal('Hello Alice');
  });
});
```

---

### Layer 2: Mock LLM Provider + Integration Tests

**Target**: ConversationRunner pipeline with deterministic LLM responses.

**Core Idea**: A `MockLlmProvider` that returns predetermined responses per call sequence, enabling fully deterministic conversation flow tests.

```typescript
// tests/integration/live/mockLlmProvider.ts
class MockLlmProvider implements ILlmProvider {
  private responses: LlmGenerationResult[] = [];
  private callIndex = 0;
  public calls: LlmMessage[][] = []; // captured for assertions

  queueResponse(text: string): void {
    this.responses.push({
      id: `mock_${this.responses.length}`,
      content: [{ contentType: 'text', text }],
      role: 'assistant',
      finishReason: 'stop',
    });
  }

  async generate(messages: LlmMessage[]): Promise<LlmGenerationResult> {
    this.calls.push(messages.map(m => ({ ...m }))); // deep copy for assertions
    const response = this.responses[this.callIndex++];
    return response ?? this.responses[this.responses.length - 1]; // fallback to last
  }

  // ... stub implementations for ILlmProvider interface
}
```

**What to Test**:
- **Conversation lifecycle**: start → on_enter → awaiting_input → user text → classification → action execution → response → end
- **Stage transitions**: `go_to_stage` effect triggers on_leave → stage switch → on_enter
- **Action execution order**: effects execute by priority
- **Variable modifications**: `modify_variables` persists to conversation stageVars
- **Tool execution**: `call_tool` with smart_function/webhook/script
- **Sample copy**: forced mode vs balanced distribution
- **Guardrails**: classification-based guardrails trigger correctly
- **Error handling**: provider failures, missing stages, etc.

**Implementation**: Tests in `tests/integration/live/` using the existing testcontainer DB + IoC container overrides.

```typescript
// tests/integration/live/conversationRunner.test.ts
describe('ConversationRunner', () => {
  let mockLlm: MockLlmProvider;
  let eventCollector: EventCollectorClientConnection;

  beforeEach(async () => {
    await resetDatabase();
    mockLlm = new MockLlmProvider();
    eventCollector = new EventCollectorClientConnection();

    // Override LlmProviderFactory to return our mock
    container.register(LlmProviderFactory, {
      useValue: { createProvider: async () => mockLlm },
    });
  });

  afterEach(() => {
    container.reset(); // restore original registrations
  });

  it('executes on_enter lifecycle on start', async () => {
    const { projectId, agentId, stageId } = await createProjectWithAgent({
      actions: {
        __on_enter: {
          name: 'On Enter',
          triggerOnUserInput: false,
          triggerOnClientCommand: false,
          parameters: [],
          effects: [
            { type: 'modify_variables', modifications: [{ variableName: 'greeted', operation: 'set', value: true }] },
            { type: 'generate_response', responseMode: 'generated' },
          ],
        },
      },
    });

    mockLlm.queueResponse('Welcome!');

    const conversation = await createConversation(projectId, stageId);
    const runner = container.resolve(ConversationRunner);
    const session = buildTestSession(projectId, conversation.id, eventCollector);

    await runner.prepareConversation(conversation.id, session, eventCollector);
    await runner.startConversation();

    // Assert on_enter executed
    expect(eventCollector.events).to.include.satisfy(e =>
      e.eventType === 'execution_plan' && e.eventData?.stageId === stageId
    );

    // Assert variable was set
    const updatedConv = await db.query.conversations.findFirst({ where: eq(conversations.id, conversation.id) });
    expect(updatedConv.stageVars?.[stageId]?.greeted).to.equal(true);

    // Assert AI response
    expect(eventCollector.aiResponses).to.include('Welcome!');

    await runner.cleanup();
  });
});
```

---

### Layer 3: Enhanced EventCollectorClientConnection

**Target**: Capture ALL conversation events for assertions (not just AI text).

Replace `TesterClientConnection` with a full-featured event collector:

```typescript
// tests/integration/live/eventCollectorClientConnection.ts
export class EventCollectorClientConnection implements IClientConnection {
  readonly connectionType: ApiKeyChannel = 'testing';

  // All CAL output messages
  public messages: CALOutputMessage[] = [];

  // Convenience accessors
  get aiResponses(): string[] {
    return this.messages
      .filter(m => m.type === 'end_ai_generation_output')
      .map(m => (m as any).fullText);
  }

  get conversationEvents(): CALConversationEventMessage[] {
    return this.messages.filter(m => m.type === 'conversation_event') as CALConversationEventMessage[];
  }

  get terminalEvent(): string | null {
    const terminal = this.conversationEvents.find(e =>
      ['conversation_end', 'conversation_aborted', 'conversation_failed'].includes(e.eventType)
    );
    return terminal ? terminal.eventType : null;
  }

  async sendMessage(message: CALOutputMessage): Promise<void> {
    this.messages.push(message);
  }

  async close(): Promise<void> {}
}
```

**What to Assert**:
- `conversation_start` / `conversation_end` events fire correctly
- `classification` events show which classifier matched which action
- `execution_plan` events show action execution order
- `jump_to_stage` events fire on stage transitions
- `variables_updated` events reflect actual variable changes
- `message` events capture both user and assistant text with visibility

---

### Layer 4: Conversation Test Harness

**Target**: Reusable test infrastructure that simplifies setting up conversation tests.

```typescript
// tests/integration/live/conversationTestHarness.ts
export class ConversationTestHarness {
  public mockLlm: MockLlmProvider;
  public events: EventCollectorClientConnection;
  public runner: ConversationRunner;
  public projectId: string;
  public conversationId: string;

  constructor() {
    this.mockLlm = new MockLlmProvider();
    this.events = new EventCollectorClientConnection();
  }

  /**
   * Set up a complete test environment with a project, agent, stage, and conversation.
   */
  async setup(stageConfig: StageConfig): Promise<this> {
    await resetDatabase();

    // Create project + agent + stage via API
    const projectRes = await authed().post('/api/projects').send(MINIMAL_PROJECT);
    this.projectId = projectRes.body.id;

    const agentRes = await authed().post(`/api/projects/${this.projectId}/agents`).send(MINIMAL_AGENT);

    const stageRes = await authed().post(`/api/projects/${this.projectId}/stages`).send({
      ...stageConfig,
      agentId: agentRes.body.id,
    });

    // Create conversation directly in DB
    this.conversationId = generateId(ID_PREFIXES.CONVERSATION);
    await db.insert(conversations).values({
      id: this.conversationId,
      projectId: this.projectId,
      userId: 'test_user',
      sessionId: `test_session_${this.conversationId}`,
      stageId: stageRes.body.id,
      status: 'initialized',
    });

    // Override IoC container
    this.overrideLlmProvider();

    // Resolve runner
    this.runner = container.resolve(ConversationRunner);

    return this;
  }

  /**
   * Start the conversation and return the harness for chaining.
   */
  async start(): Promise<this> {
    const session = buildTestSession(this.projectId, this.conversationId, this.events);
    await this.runner.prepareConversation(this.conversationId, session, this.events);
    await this.runner.startConversation();
    return this;
  }

  /**
   * Send user text input and wait for AI response.
   */
  async sendInput(text: string): Promise<string> {
    this.mockLlm.queueResponse(text); // queue response for next LLM call
    await this.runner.receiveUserTextInput(text);
    return this.events.aiResponses[this.events.aiResponses.length - 1];
  }

  /**
   * Assert that a conversation event of the given type was emitted.
   */
  assertEvent(eventType: string): this {
    expect(this.events.conversationEvents).to.include.satisfy(e => e.eventType === eventType);
    return this;
  }

  /**
   * Get the current conversation state from DB.
   */
  async getConversation() {
    return db.query.conversations.findFirst({
      where: eq(conversations.id, this.conversationId),
    });
  }

  async teardown() {
    await this.runner.cleanup();
    container.reset();
  }
}
```

**Usage**:
```typescript
describe('Stage Transitions', () => {
  let harness: ConversationTestHarness;

  beforeEach(async () => {
    harness = new ConversationTestHarness();
  });

  afterEach(async () => {
    await harness.teardown();
  });

  it('transitions to another stage via go_to_stage effect', async () => {
    await harness.setup({
      name: 'Stage A',
      prompt: 'You are stage A.',
      llmProviderId: 'openai',
      llmSettings: { provider: 'openai', model: 'gpt-4', temperature: 0.7 },
      actions: {
        __on_enter: { /* ... */ effects: [{ type: 'generate_response' }] },
        goToB: { /* ... */ effects: [{ type: 'go_to_stage', stageId: 'stage_b' }] },
      },
    });

    // Queue responses: on_enter greeting, then post-transition on_enter
    harness.mockLlm.queueResponse('Hello from A!');
    harness.mockLlm.queueResponse('Hello from B!');

    await harness.start();
    harness.assertEvent('conversation_start');

    // Trigger transition
    await harness.runner.runAction('goToB', {});
    harness.assertEvent('jump_to_stage');

    expect(harness.events.aiResponses).to.include('Hello from B!');
  });
});
```

---

### Layer 5: Existing Scenario Run System (Keep As-Is)

The Scenario Run system (`TestRunner` + `ScenarioRunExecutorService`) remains the **end-to-end integration test layer**. It validates:
- Real LLM interactions work correctly
- Multi-turn conversations with realistic tester personas
- Post-run evaluation (data extraction, context transformers)
- Full pipeline including ASR/TTS (when configured)

**Improvement**: Add a `tests/integration/testing/` suite that validates the Scenario Run system itself — e.g., that the evaluator correctly handles all comparison modes, that TestRunner handles edge cases, etc.

---

## Implementation Plan

### Phase 1: Foundation (Week 1)
1. Create `tests/unit/live/` directory structure
2. Implement unit tests for pure components:
   - `TemplatingEngine` (variable interpolation, conditionals)
   - `ModifyVariablesEffectExecutor` (set/reset/add/reset)
   - `ModifyUserProfileEffectExecutor`
   - `SampleCopyDistributor` (forced vs balanced)
   - `effectValueTransformer`
3. Create `tests/integration/live/` directory structure
4. Implement `MockLlmProvider`
5. Implement `EventCollectorClientConnection`

### Phase 2: Integration Tests (Week 2)
1. Implement `ConversationTestHarness`
2. Write ConversationRunner integration tests:
   - Conversation lifecycle (start → input → response → end)
   - Stage transitions (go_to_stage, on_enter/on_leave)
   - Action execution order (priority-based)
   - Variable modifications (persist to DB)
   - Tool calls (smart_function, webhook, script)
   - Sample copy (forced mode, balanced distribution)
   - Guardrails (classification-based)
   - Error handling (missing stage, provider failure)

### Phase 3: ActionsExecutor + Script Tests (Week 3)
1. Test each effect type in isolation:
   - `generate_response` (generated, prescripted)
   - `end_conversation` / `abort_conversation`
   - `go_to_stage`
   - `modify_user_input`
   - `modify_variables` / `modify_user_profile`
   - `call_tool` (synchronous and asynchronous)
   - `change_visibility`
   - `ban_user`
   - `save_artifact` / `attach_file`
2. Test effect priority ordering
3. Test lifecycle action restrictions
4. **IsolatedScriptExecutor** unit tests:
   - Script execution with context injection (vars, history, stageVars, time, channel)
   - Mutable context (vars, userProfile) persists after execution
   - Flow control signals (goToStage, endConversation, abortConversation)
   - Security: memory limits, timeouts, sandboxed APIs
   - Error handling: script syntax errors, runtime errors, timeout
   - Conditional visibility evaluation (used by HistoryBuilder)

### Phase 4: UserInputProcessor + ContextBuilder + History (Week 4)
1. Test classification routing (default classifier, action overrides)
2. Test action matching (classificationTrigger, triggerOnUserInput, etc.)
3. Test context building (history, variables, tools, knowledge)
4. Test context transformers
5. **HistoryBuilder** tests:
   - Message visibility: always (default), stage, never, conditional
   - Stage tracking across conversation_start and jump_to_stage events
   - Conditional visibility with script evaluation
   - Empty message filtering
6. **contextTruncation** unit tests:
   - System message preservation
   - Oldest message removal
   - Token estimation accuracy
   - Edge cases: empty array, single message, already within budget
7. **ResponseGenerator** tests:
   - Message ordering (system, history, user, assistantPrefix)
   - Context truncation integration
   - Streaming callback wiring

### Phase 5: Testing Infrastructure Tests (Week 5)
1. Test `ScenarioConversationEvaluator` comparison modes
2. Test `TestRunner` edge cases
3. Test `TesterClientConnection` event handling

---

## File Structure

```
tests/
  e2e/                    # Existing HTTP API tests (925 tests)
  unit/
    live/                 # NEW: Unit tests for pure components
      templatingEngine.test.ts
      modifyVariablesEffectExecutor.test.ts
      modifyUserProfileEffectExecutor.test.ts
      sampleCopyDistributor.test.ts
      effectValueTransformer.test.ts
  integration/
    live/                 # NEW: Conversation runner integration tests
      mockLlmProvider.ts
      eventCollectorClientConnection.ts
      conversationTestHarness.ts
      conversationRunner.test.ts
      actionsExecutor.test.ts
      userInputProcessor.test.ts
      contextBuilder.test.ts
      toolExecutor.test.ts
    testing/              # NEW: Testing infrastructure tests
      scenarioConversationEvaluator.test.ts
      testRunner.test.ts
```

---

## Key Design Decisions

### 1. Mock LLM Provider Strategy
- **Sequential response queue**: `queueResponse()` pushes responses in order; `generate()` pops from queue
- **Call capture**: Every `generate()` call stores the messages for assertion (prompt verification)
- **Fallback**: If queue exhausted, returns last response (prevents test crashes)
- **Streaming support**: Mock `generateStream()` for TTS path testing

### 2. IoC Container Overrides
- Use `container.register()` / `container.reset()` for per-test mock injection
- Alternative: create a fresh `Container` per test suite (cleaner isolation)
- For DB-dependent tests, use the existing testcontainer + `resetDatabase()`

### 3. Event Collection
- `EventCollectorClientConnection` captures ALL `CALOutputMessage` types
- Convenience accessors (`aiResponses`, `conversationEvents`, `terminalEvent`) reduce boilerplate
- Supports `waitForAiResponse()` pattern for async tests

### 4. Test Isolation
- Each test gets a fresh DB state via `resetDatabase()`
- IoC container is reset between tests
- Mock LLM provider is created per-test (no shared state)

### 5. What NOT to Test
- **ASR/TTS audio processing** — requires real audio hardware or complex mocking; covered by Scenario Runs
- **WebSocket/WebRTC transport** — covered by HTTP e2e tests + channel-level integration
- **Real LLM output quality** — covered by Scenario Runs
- **Database schema** — covered by Drizzle migrations + existing e2e tests
- **Email channel delivery** (SMTP/IMAP, SendGrid, SES) — requires real mail servers; covered by Scenario Runs
- **Telegram/WhatsApp/Twilio webhooks** — requires real provider credentials; covered by Scenario Runs
- **Voice conversation flows** (VAD, barge-in, filler sentences) — complex audio pipeline; covered by Scenario Runs with voice-enabled testers

---

## Estimated Coverage After Implementation

| Component | Lines | Target Coverage |
|---|---|---|
| TemplatingEngine | 278 | 90%+ (unit) |
| ModifyVariablesEffectExecutor | 99 | 95%+ (unit) |
| ModifyUserProfileEffectExecutor | 106 | 95%+ (unit) |
| SampleCopyDistributor | 86 | 90%+ (unit) |
| effectValueTransformer | 80 | 95%+ (unit) |
| ActionsExecutor | 1065 | 80%+ (integration) |
| ConversationRunner | 3338 | 70%+ (integration) |
| UserInputProcessor | 357 | 80%+ (integration) |
| ConversationContextBuilder | 1163 | 60%+ (integration) |
| ToolExecutor | 264 | 80%+ (integration) |
| IsolatedScriptExecutor | 284 | 80%+ (unit + integration) |
| ResponseGenerator | 44 | 80%+ (integration) |
| HistoryBuilder | 114 | 80%+ (integration) |
| ConversationRecorder | 136 | 80%+ (unit) |
| ContextTransformerExecutor | 296 | 70%+ (integration) |
| truncateMessagesToTokenBudget | 81 | 95%+ (unit) |
