# How It Works — Designing Projects and Conversations in Nexus

This guide explains how entities in Nexus work together to power real-time AI conversations. It is written for project designers — people who create and configure projects, stages, personas, classifiers, actions, tools, and knowledge bases.

---

## Table of Contents

- [System Overview](#system-overview)
- [Entity Hierarchy](#entity-hierarchy)
- [Project](#project)
- [Persona](#persona)
- [Stage](#stage)
  - [Stage Prompt (System Prompt)](#stage-prompt-system-prompt)
  - [Enter Behavior](#enter-behavior)
  - [Variables](#variables)
  - [Actions](#actions)
  - [Lifecycle Actions (Special Actions)](#lifecycle-actions-special-actions)
  - [Global Actions](#global-actions)
  - [Knowledge Base Integration](#knowledge-base-integration)
- [Classifier](#classifier)
- [Context Transformer](#context-transformer)
  - [Transformer-Triggered Actions](#transformer-triggered-actions)
- [Tool](#tool)
- [Provider](#provider)
- [Effects](#effects)
  - [Prescripted Responses](#prescripted-responses)
  - [Effect Value Resolution](#effect-value-resolution)
- [Conversation Lifecycle](#conversation-lifecycle)
  - [1. Connection and Authentication](#1-connection-and-authentication)
  - [2. Starting a Conversation](#2-starting-a-conversation)
  - [3. Resuming a Conversation](#3-resuming-a-conversation)
  - [4. User Input Processing](#4-user-input-processing)
  - [5. Classification and Transformation (Parallel)](#5-classification-and-transformation-parallel)
  - [6. Action Execution](#6-action-execution)
  - [7. Response Generation](#7-response-generation)
  - [8. Stage Transitions](#8-stage-transitions)
  - [9. Ending a Conversation](#9-ending-a-conversation)
- [Conversation State Machine](#conversation-state-machine)
- [Context — What the AI Sees](#context--what-the-ai-sees)
- [Effect Execution Order](#effect-execution-order)
- [WebSocket Commands](#websocket-commands)
- [Session Settings](#session-settings)
- [Multimodal Support](#multimodal-support)
- [Conversation Events](#conversation-events)
- [Administration and Operations](#administration-and-operations)
  - [RBAC Permissions](#rbac-permissions)
  - [Cross-Instance Migration](#cross-instance-migration)
  - [Issue Tracking](#issue-tracking)
  - [API Versioning](#api-versioning)
  - [Audit Logging](#audit-logging)
- [Design Patterns and Best Practices](#design-patterns-and-best-practices)
- [End-to-End Example](#end-to-end-example)
- [Related Documentation](#related-documentation)

---

## System Overview

Nexus is a real-time conversational AI platform. Clients connect over WebSocket and interact with AI personas through a structured flow of **stages**. Each stage defines its own system prompt, available actions, variables, and behavior. The system classifies user input, executes actions with side effects, and generates streamed AI responses — optionally with text-to-speech.

The high-level data flow for every conversation turn looks like this:

```
User Input (text or voice)
    │
    ▼
┌─────────────────────┐
│   ASR (if voice)    │  Voice → Text
└─────────┬───────────┘
          │
          ▼
┌─────────────────────────────────────────────┐
│  Classification + Context Transformation    │
│  (run in parallel)                          │
│                                             │
│  ┌───────────────────┐  ┌────────────────┐  │
│  │ Classification    │  │ Transformers   │  │
│  │ (intent + params) │  │ (enrich vars)  │  │
│  └───────────────────┘  └────────────────┘  │
└─────────────────┬───────────────────────────┘
                  │
                  ▼
┌─────────────────────┐
│  Action Execution   │  Execute matched + transformer-triggered actions
│  (effects pipeline) │  (webhooks, tools, scripts, variable changes, etc.)
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  Response Generation │  Render system prompt with context, call LLM
│  (streamed)         │  Stream text/image/audio chunks to client
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  TTS (if enabled)   │  Text → Voice, streamed audio to client
└─────────────────────┘
```

---

## Entity Hierarchy

All design-time entities are organized under a **Project**. All project-scoped entities use composite primary keys `(projectId, id)`. Here is the ownership hierarchy:

```
Project
├── Personas          (AI character definitions with voice config)
├── Stages            (conversation flow nodes)
│   ├── → Persona     (each stage references one persona)
│   ├── → Classifier  (optional default classifier for the stage)
│   ├── → LLM Provider (optional per-stage LLM for response generation)
│   ├── → Transformers (optional context transformers)
│   ├── Actions       (stage-specific actions, stored inline on the stage)
│   └── → Knowledge   (optional knowledge tags to include)
├── Classifiers       (reusable LLM-based intent classifiers)
├── Context Transformers (reusable LLM-based data transformers)
├── Tools             (reusable LLM-powered tools, callable from actions)
├── Global Actions    (actions available across multiple stages, with parameters)
├── Knowledge Categories / Items (organized by tags)
├── API Keys          (authentication for WebSocket clients)
├── Users             (user profiles, persistent across conversations)
├── Conversations     (conversation state, variables, events, artifacts)
├── Issues            (bug tracking per project)
└── Providers         (LLM, TTS, ASR, Storage, Embeddings credentials — shared across projects)
```

---

## Project

A **Project** is the top-level container. It groups all entities that belong to a single conversational experience.

| Setting | Purpose |
|---------|---------|
| `name` | Display name of the project |
| `description` | Optional description |
| `acceptVoice` | Whether clients can send voice input |
| `generateVoice` | Whether the system produces voice output |
| `asrConfig` | ASR provider and settings (language, dictionary phrases, audio format, unintelligible placeholder, voice activity detection) |
| `storageConfig` | Storage provider for conversation artifacts (recordings, transcriptions, etc.) |
| `constants` | Project-wide constant values (available in templates) |
| `metadata` | Custom project-level metadata |

When a client authenticates with an API key, the key is tied to a project. All subsequent conversations happen within that project's configuration.

---

## Persona

A **Persona** defines the AI character. Each stage references exactly one persona.

| Field | Purpose |
|-------|---------|
| `name` | Display name (e.g., "Customer Support Agent") |
| `description` | Optional human-readable description of the persona |
| `prompt` | The persona prompt injected into context as `{{persona}}` — defines personality, tone, background |
| `ttsProviderId` | Which TTS provider to use for this persona's voice |
| `ttsSettings` | Voice configuration (voice ID, model, speed, stability, etc.) |

**How it's used at runtime:** When the system builds the context for response generation, the persona's `prompt` field is available as `{{persona}}` in the stage's system prompt template. The TTS settings determine how the AI's text responses are converted to speech.

**Design tip:** You can have multiple personas in a project and assign different ones to different stages. For example, a "Receptionist" persona for a greeting stage and a "Technical Expert" persona for a troubleshooting stage — each with different voice, tone, and behavior. Personas support cloning via a dedicated API endpoint.

---

## Stage

A **Stage** is the core building block of a conversation flow. It defines everything that happens during a particular phase of the conversation: the system prompt, which actions are available, which variables to track, and how the AI should behave.

Think of stages as screens or scenes in a conversation. A user is always in exactly one stage at a time.

### Stage Prompt (System Prompt)

The `prompt` field is a **Handlebars template** that becomes the LLM's system prompt. It has access to the full conversation context:

```handlebars
{{persona}}

You are helping {{default userProfile.name "the user"}} with their order.

Current order status: {{vars.orderStatus}}
Customer tier: {{default userProfile.tier "standard"}}

{{#if stage.useKnowledge}}
Use the knowledge base to answer product questions accurately.
{{/if}}

{{#each stage.availableActions}}
- {{name}}: {{trigger}}
{{/each}}
```

The prompt is rendered fresh on every response generation, so it always reflects the latest variable values, user profile, and conversation history. See [TEMPLATING.md](./TEMPLATING.md) for the full template reference.

Each stage can optionally specify its own **LLM provider** via `llmProviderId` and `llmSettings`, allowing different stages to use different models for response generation (e.g., a simpler model for greetings and a more capable one for complex reasoning).

### Enter Behavior

When a conversation enters a stage (either at start or via a `go_to_stage` effect), the `enterBehavior` setting controls what happens next:

| Value | Behavior |
|-------|----------|
| `generate_response` | The AI immediately generates a response (e.g., a greeting or introduction). This is the default. |
| `await_user_input` | The system waits silently for the user to speak or type first. |

### Variables

Each stage can define **variable descriptors** — a schema of variables that the stage uses. Variables are key-value pairs scoped to a stage and persisted across turns within the conversation.

Variables are:
- **Accessible in templates** as `{{vars.myVariable}}`
- **Cross-stage accessible** via `{{stageVars.otherStageId.variableName}}` in templates
- **Modifiable** through `modify_variables` effects, `run_script` effects, or WebSocket commands (`set_var`)
- **Scoped per stage** — each stage has its own variable namespace stored as `stageVars[stageId]`
- **Persistent** — saved to the database after each turn
- **Watchable** — transformers can write to variables, and actions can trigger on variable changes via `watchedVariables`

Common uses for variables:
- Tracking conversation progress (step counters, form fields)
- Storing data fetched from webhooks
- Flags that control conditional logic in prompts or action conditions
- Accumulating scores or counts

### Actions

Actions are the primary mechanism for the system to **react to user input beyond generating a text response**. Each stage defines a map of actions (keyed by action name) that describe:

| Field | Purpose |
|-------|---------|
| `name` | Human-readable display name |
| `classificationTrigger` | Description of when this action should fire — the classifier uses this to determine intent |
| `triggerOnUserInput` | Whether this action can be triggered by user input classification |
| `triggerOnClientCommand` | Whether this action can be triggered by WebSocket commands |
| `triggerOnTransformation` | Whether this action can be triggered by context transformer variable changes |
| `watchedVariables` | Map of variable paths to watch conditions (`new`, `changed`, `removed`) — used with `triggerOnTransformation` |
| `condition` | Optional JavaScript expression that must return truthy for the action to be active |
| `overrideClassifierId` | If set, this action is only evaluated by that specific classifier |
| `parameters` | Array of parameters to extract from user input (name, type, description, required) |
| `effects` | Array of effects to execute when the action triggers |
| `examples` | Example phrases that trigger this action (helps the classifier) |
| `metadata` | Optional action-specific metadata |

**How actions work at runtime:**

1. User input arrives
2. The classifier sees the list of active actions (filtered by `triggerOnUserInput`, `condition`, and `overrideClassifierId`)
3. The classifier determines which action(s) match and extracts parameters
4. Simultaneously, context transformers may write to variables and trigger `watchedVariables`-based actions
5. All matched actions' effects are gathered, sorted by priority, conflict-resolved, and executed
6. If no action matches and `__on_fallback` is defined, the fallback action runs instead

**Parameter extraction:** When an action has parameters, the classifier extracts them from the user's message. For example, an action "Transfer Call" with parameter `department (string, required)` will extract the department name from "Transfer me to billing." Parameters are then available in templates as `{{actions.transfer_call.parameters.department}}`.

**Supported parameter types:** `string`, `number`, `boolean`, `object`, `string[]`, `number[]`, `boolean[]`, `object[]`, `image`, `image[]`, `audio`, `audio[]`

### Lifecycle Actions (Special Actions)

Three reserved action names trigger at specific lifecycle points instead of user input:

| Action | When it runs | Typical use |
|--------|-------------|-------------|
| `__on_enter` | When entering the stage (before `enterBehavior`) | Initialize variables, fetch data from APIs, set up state |
| `__on_leave` | When leaving the stage (before loading the new stage) | Clean up, save progress, send analytics |
| `__on_fallback` | When no regular action matches user input | Track unmatched inputs, provide hints, escalate |

Lifecycle actions have **effect restrictions** to prevent logical conflicts:

| Lifecycle | Restricted effects |
|-----------|-------------------|
| `__on_enter` | `end_conversation`, `abort_conversation`, `go_to_stage` |
| `__on_leave` | `go_to_stage`, `generate_response` |
| `__on_fallback` | None (all effects allowed) |

See [SPECIAL_ACTIONS.md](./SPECIAL_ACTIONS.md) for detailed examples.

### Global Actions

Global actions are defined at the project level and can be active across multiple stages. Each stage controls global action usage through two settings:

| Setting | Behavior |
|---------|----------|
| `useGlobalActions` | Master toggle — enables or disables all global actions for this stage |
| `globalActions` | Array of specific global action IDs to include. Empty array = include all. |

Global actions work the same as stage actions in terms of classification and effect execution. They support parameters for extracting structured data from user input, just like stage actions. They are useful for cross-cutting concerns like "end conversation", "go to main menu", or "speak to a human" that should be available regardless of which stage the user is in.

### Knowledge Base Integration

When `useKnowledge` is true and `knowledgeTags` is configured, the stage includes knowledge from matching categories:

- **Knowledge Categories** define topics with a `promptTrigger` (when to surface this knowledge) and are organized by `tags`
- **Knowledge Items** are individual Q&A pairs within a category
- Stages select knowledge by specifying `knowledgeTags` — all categories with matching tags are included

This structured knowledge is injected into the context (as `faq` items) so the LLM can provide accurate, factual answers on specific topics. FAQ data is cached per stage and persisted between turns until new knowledge actions are detected.

---

## Classifier

A **Classifier** is a reusable LLM-based component that analyzes user input and determines which actions the user is trying to trigger.

| Field | Purpose |
|-------|---------|
| `prompt` | Handlebars template for the classification prompt — includes available actions, their triggers, examples, and parameters |
| `llmProviderId` | Which LLM provider to use for classification |
| `llmSettings` | LLM settings (model, temperature, max tokens, etc.) |

**How classifiers work at runtime:**

1. The stage has a `defaultClassifierId` — this is the primary classifier for the stage
2. Individual actions can override the classifier using `overrideClassifierId` — causing them to be evaluated by a different classifier
3. All unique classifier IDs are collected from the stage's default and action overrides
4. For each classifier, the system builds a context with only the actions assigned to that classifier
5. Each classifier runs **in parallel** — calling its LLM with the classification prompt and user input
6. Results from all classifiers are merged and deduplicated (same action detected by multiple classifiers is only processed once)

**Design tip:** Use a single classifier for most stages. Use `overrideClassifierId` when you have specialized actions that need a different LLM or prompt (e.g., a cheaper, faster model for simple yes/no detection alongside a more capable model for complex intent extraction).

---

## Context Transformer

A **Context Transformer** is a reusable LLM-based component that transforms or enriches conversation data before it reaches the main response generation. Transformers run **in parallel with classification** — this is an important architectural detail.

| Field | Purpose |
|-------|---------|
| `prompt` | Handlebars template for the transformation prompt |
| `contextFields` | Which context fields to include in the transformation |
| `llmProviderId` | Which LLM provider to use |
| `llmSettings` | LLM settings |

Stages reference transformers via the `transformerIds` array. Multiple transformers can be chained on a single stage. After execution, transformers write their extracted fields to stage variables (`stageVars`), and a `transformation` event is recorded with the list of applied fields.

### Transformer-Triggered Actions

Transformers can indirectly trigger actions through the **watched variables** mechanism:

1. A transformer runs and writes fields to stage variables
2. Actions with `triggerOnTransformation: true` and matching `watchedVariables` are evaluated
3. `watchedVariables` maps variable names to conditions:
   - `new` — triggers when the variable is created for the first time
   - `changed` — triggers when the variable's value changes
   - `removed` — triggers when the variable is deleted
4. If any watched variable condition matches, the action's effects are executed

This allows building reactive pipelines where transformers extract structured data from user input and actions automatically fire based on the extracted values.

---

## Tool

A **Tool** is a reusable LLM-powered utility that can be invoked during conversation processing via the `call_tool` effect or the `call_tool` WebSocket command.

| Field | Purpose |
|-------|---------|
| `prompt` | Handlebars template for the tool's system prompt |
| `parameters` | Array of parameter definitions (name, type, description, required) |
| `inputType` | Expected input format: `text`, `image`, or `multi-modal` |
| `outputType` | Expected output format: `text`, `image`, or `multi-modal` |
| `llmProviderId` | Which LLM provider powers this tool |
| `llmSettings` | LLM settings |

**How tools work at runtime:**

1. An action effect of type `call_tool` fires with a `toolId` and `parameters`
2. The system loads the tool and its LLM provider
3. The tool's prompt template is rendered with the full conversation context plus the tool parameters
4. The LLM is called (non-streaming) with the rendered prompt
5. The result is stored in `context.results.tools[toolId]` and available in subsequent templates
6. A `tool_call` event is recorded with the tool name, parameters, success status, and result

**Design tip:** Tools are ideal for tasks that need a separate LLM call with a specialized prompt — sentiment analysis, data extraction, summarization, image generation, etc. Keep tool prompts focused on a single task. Tools can also be invoked directly from WebSocket clients using the `call_tool` command.

---

## Provider

**Providers** are credential configurations for external services. They are not project-scoped — they can be shared across projects.

| Provider Type | Purpose | Supported API Types |
|--------------|---------|---------------------|
| `llm` | Language model inference | `openai`, `openai-legacy`, `anthropic`, `gemini`, `groq`, `vertex` |
| `tts` | Text-to-speech synthesis | `elevenlabs`, `openai`, `deepgram`, `cartesia`, `azure` |
| `asr` | Automatic speech recognition | `azure`, `elevenlabs`, `deepgram` |
| `storage` | Artifact storage | `s3`, `azure-blob`, `gcs`, `local` |
| `embeddings` | Embedding generation | (reserved for future use) |

Each provider stores its API type and credentials in its `config` field. Entities like stages, classifiers, tools, and personas reference providers by ID.

A **Provider Catalog** API is available that lists all supported provider capabilities — models, voices, languages, and features — without requiring valid credentials.

---

## Effects

Effects are the building blocks of action behavior. When an action triggers, its effects define what actually happens. Effects are executed in a fixed priority order across all matched actions.

| Effect | Priority | Description |
|--------|----------|-------------|
| `call_webhook` | 1 | Call an external HTTP endpoint, store the response in `results.webhooks[resultKey]` |
| `call_tool` | 2 | Invoke a tool via LLM, store the result in `results.tools[toolId]` |
| `modify_variables` | 3 | Set, reset, add to, or remove from stage variables |
| `modify_user_profile` | 4 | Set, reset, add to, or remove from user profile fields |
| `modify_user_input` | 5 | Replace user input using a rendered template (redact, inject whisper, transform) |
| `run_script` | 6 | Execute JavaScript in an isolated sandbox (can modify `vars`, `userProfile`, `userInput`) |
| `generate_response` | 7 | Flag the system to generate an AI response after effects complete |
| `end_conversation` | 8 | Gracefully end the conversation |
| `abort_conversation` | 9 | Immediately abort the conversation |
| `go_to_stage` | 10 | Navigate to a different stage |

**Key behaviors:**

- Effects from **all matched actions** are gathered into a single pool, sorted by priority, and then executed in order
- **Conflict resolution** handles contradictions automatically (e.g., multiple `go_to_stage` effects — only the first is used; `abort_conversation` takes precedence over `end_conversation`)
- Webhooks and tools execute **before** variable modifications and scripts, so fetched data is available for downstream effects
- `call_webhook` supports Handlebars templates in URL, headers, and body — so you can include `{{vars.userId}}` or `{{userProfile.email}}` in webhook URLs
- `run_script` executes arbitrary JavaScript in a sandboxed VM with access to `vars`, `userProfile`, `userInput`, `history`, `actions`, and `results` — see [SCRIPTING.md](./SCRIPTING.md)
- If no action explicitly includes `generate_response`, the system will still generate a response by default (when no actions match, or after actions complete without ending/aborting the conversation)

### Prescripted Responses

The `generate_response` effect supports a `responseMode` field that controls how the response is produced:

| Mode | Behavior |
|------|----------|
| `generated` (default) | Standard AI-generated response via LLM |
| `prescripted` | Select from a list of predefined responses — no LLM call |

When using `prescripted` mode, provide `prescriptedResponses` (array of strings) and optionally `prescriptedSelectionStrategy`:
- `random` (default) — pick a random response from the list
- `round_robin` — cycle through responses in order

This is useful for deterministic responses like greetings, confirmations, or error messages where LLM variability is undesirable.

### Effect Value Resolution

Effect values in `modify_variables` and `modify_user_profile` support special resolution patterns beyond plain values:

| Pattern | Behavior |
|---------|----------|
| `{{results.tools.toolId.result}}` | Resolve from tool execution results |
| `{{vars.variableName}}` | Resolve from current stage variables |
| `{{stageVars.stageName.variableName}}` | Resolve from another stage's variables |
| `{{userProfile.fieldName}}` | Resolve from user profile fields |
| `= <expression>` | Evaluate as inline JavaScript expression |
| Any other string | Rendered through Handlebars template engine |

Non-string values (numbers, booleans, objects) are passed through unchanged.

---

## Conversation Lifecycle

### 1. Connection and Authentication

1. Client connects to `ws://host/ws`
2. Client sends `auth` message with API key and optional `sessionSettings`
3. Server validates the key, creates a session, and returns `projectSettings` (voice capabilities, ASR config)

### 2. Starting a Conversation

1. Client sends `start_conversation` with `userId`, `stageId`, and optional `personaId`
2. Server creates a Conversation record in the database (status: `initialized`)
3. Server loads the stage and all its dependencies (persona, classifiers, transformers, global actions, providers)
4. Server initializes providers (ASR, TTS, LLM) and wires up event callbacks
5. A `conversation_start` event is recorded
6. **`__on_enter` runs** (if defined on the stage)
   - Effects execute in priority order
   - If `__on_enter` ends or aborts the conversation, stop here
7. **`enterBehavior` is processed:**
   - `generate_response` → The stage prompt is rendered with context and the LLM generates a response (e.g., a greeting). Response is streamed as text chunks and optionally as audio chunks via TTS.
   - `await_user_input` → Conversation silently waits for the user

### 3. Resuming a Conversation

Existing conversations can be resumed using the `resume_conversation` WebSocket message:

1. Client sends `resume_conversation` with `conversationId`
2. Server loads the existing conversation state, stage, and all dependencies
3. Providers are re-initialized for the current stage
4. A `conversation_resume` event is recorded (including previous status)
5. Conversation returns to `awaiting_user_input` state

This enables reconnecting after disconnects or switching between conversations.

### 4. User Input Processing

User input arrives in one of two ways:

**Text input:**
1. Client sends `send_user_text_input` message
2. Server immediately processes the text

**Voice input:**
1. Client sends `start_user_voice_input`
2. Client streams audio data via `send_user_voice_chunk` messages
3. Client sends `end_user_voice_input`
4. ASR provider transcribes audio chunks in real-time, sending interim and final transcriptions back to the client (`user_transcribed_chunk`)
5. Once ASR completes, the full transcribed text enters the same processing pipeline as text input

### 5. Classification and Transformation (Parallel)

Once user input text is available, classification and context transformation run **simultaneously**:

**Classification path:**
1. The system collects all unique classifier IDs for the current stage (from `defaultClassifierId` and action-level `overrideClassifierId`)
2. For each classifier, a context is built with only the actions relevant to that classifier
3. Each classifier receives the rendered classification prompt (which lists available actions with triggers, examples, and parameters) plus the user input
4. The LLM returns a structured JSON result indicating which action(s) matched and extracted parameter values
5. Results from all classifiers are merged; duplicate action detections are removed
6. A `classification` event is recorded and sent to the client

**Transformation path (parallel):**
1. All transformers referenced by the stage's `transformerIds` execute in parallel
2. Each transformer calls its LLM with a specialized prompt and the user input
3. Transformer results are written to stage variables
4. `transformation` events are recorded with the list of applied fields
5. Actions with `triggerOnTransformation: true` are evaluated against watched variable conditions
6. Any triggered transformer-actions are added to the action pool

### 6. Action Execution

After classification and transformation complete:

1. Stage actions and global actions are matched by name against classifier results
2. Transformer-triggered actions are added to the match pool
3. Extracted parameters are injected into the context (`context.actions[actionName].parameters`)
4. If **no actions matched** and `__on_fallback` is defined, the fallback action is executed instead
5. All matched action effects are pooled together
6. Effects restricted by lifecycle context (if applicable) are filtered out
7. Effects are sorted by priority (webhooks first, stage navigation last)
8. Conflicts are resolved (multiple `go_to_stage` → keep first; `abort` overrides `end`)
9. Effects execute sequentially in priority order:
   - Webhooks and tools call external services, storing results in context
   - Variable and profile modifications update the context in place (with value resolution)
   - Scripts run in an isolated VM with access to the full mutable context
   - `generate_response` sets a flag for response generation
   - `end_conversation` / `abort_conversation` set termination flags
   - `go_to_stage` records the target stage for navigation
10. After all effects complete:
    - An `action` event is recorded for each matched action
    - Modified variables are persisted to the database
    - Modified user profile is persisted to the database
    - If `go_to_stage` was flagged, the stage transition happens (see [Stage Transitions](#8-stage-transitions))
    - If conversation was ended or aborted, appropriate events are saved

### 7. Response Generation

If effects completed without ending/aborting the conversation and a response should be generated:

1. The stage's `prompt` template is rendered with the full context (variables, user profile, persona, history, actions with parameters, webhook/tool results, FAQ items)
2. The rendered prompt becomes the LLM's system message
3. Conversation history (all previous user and assistant messages) is sent as message context
4. The current user input is sent as the final user message
5. `start_ai_generation_output` is sent to the client (includes `outputTurnId` and `expectVoice` flag)
6. The LLM generates a streaming response:
   - Each text chunk is sent to the client via WebSocket (`ai_transcribed_chunk`)
   - Each text chunk is simultaneously fed to the TTS provider (if configured)
   - TTS generates audio chunks that are sent to the client (`send_ai_voice_chunk`)
   - For multimodal responses, `send_ai_image_output` or `send_ai_audio_output` messages are sent
7. When generation completes, the full text is saved as a `message` event
8. When TTS completes (or immediately if no TTS), `end_ai_generation_output` is sent to the client
9. Conversation state returns to `awaiting_user_input`

### 8. Stage Transitions

When a `go_to_stage` effect fires (or a client sends a `go_to_stage` WebSocket command):

1. **`__on_leave` runs on the current stage** (if defined)
   - Cleanup effects execute
   - If `__on_leave` ends or aborts the conversation, stop here
2. New stage is loaded from the database with all dependencies
3. Conversation's `stageId` is updated in the database
4. Providers are re-initialized for the new stage (new LLM, TTS, ASR as needed)
5. A `jump_to_stage` event is saved (with `fromStageId` and `toStageId`)
6. **`__on_enter` runs on the new stage** (if defined)
   - Initialization effects execute
   - If `__on_enter` ends or aborts the conversation, stop here
7. New stage's `enterBehavior` is processed:
   - `generate_response` → AI generates a response using the new stage's prompt
   - `await_user_input` → Wait for the user

### 9. Ending a Conversation

Conversations can end in three ways:

| End Type | Trigger | Behavior |
|----------|---------|----------|
| **Finished** | `end_conversation` effect or client `end_conversation` message | Graceful end — conversation status becomes `finished`; `conversation_end` event recorded |
| **Aborted** | `abort_conversation` effect or client disconnect | Immediate stop — status becomes `aborted`; `conversation_aborted` event recorded |
| **Failed** | System error (LLM failure, ASR error, etc.) | Error state — status becomes `failed` with a reason; `conversation_failed` event recorded |

---

## Conversation State Machine

The conversation progresses through these states:

```
initialized ──────────────► awaiting_user_input ◄────────────────┐
                                    │                             │
                 ┌──────────────────┼────────────┐                │
                 │                  │             │                │
                 ▼                  ▼             │                │
        receiving_user_voice   processing_user_input              │
                 │                  │             │                │
                 └──────────────────┘             │                │
                          │                       │                │
                          ▼                       │                │
                 generating_response ─────────────┘                │
                          │                                        │
                          └────────────────────────────────────────┘
                          │
                          ▼
                 finished / aborted / failed
```

| State | Description |
|-------|-------------|
| `initialized` | Conversation created but not yet started |
| `awaiting_user_input` | Ready for user text or voice input |
| `receiving_user_voice` | Streaming voice audio from client to ASR |
| `processing_user_input` | Classifying input, running transformers, and executing action effects |
| `generating_response` | LLM is generating and streaming a response |
| `finished` | Conversation ended gracefully |
| `aborted` | Conversation was aborted |
| `failed` | Conversation failed due to an error |

---

## Context — What the AI Sees

Every time the system renders a prompt template, builds a classification prompt, or executes a script, it uses the **ConversationContext**. Understanding this context is key to designing effective prompts and actions.

| Context Field | Type | Description |
|--------------|------|-------------|
| `conversationId` | string | Unique conversation identifier |
| `projectId` | string | Project identifier |
| `persona` | string | The persona's prompt text |
| `vars` | object | Stage variables (from `stageVars[currentStageId]`) |
| `stageVars` | object | All stage variables indexed by stage ID — allows cross-stage variable access |
| `userProfile` | object | User's profile data (persistent across conversations) |
| `history` | array | All previous messages: `[{ role: 'user'\|'assistant', content: '...' }]` |
| `userInput` | string | Current user input text (can be modified by effects) |
| `originalUserInput` | string | Original user input before any modifications |
| `userInputSource` | string | `'text'` or `'voice'` |
| `actions` | object | Triggered actions with extracted parameters: `{ actionName: { parameters: {...} } }` |
| `results.webhooks` | object | Webhook call results keyed by `resultKey` |
| `results.tools` | object | Tool execution results keyed by `toolId` |
| `faq` | array | Knowledge base FAQ items from matching categories (persisted between turns) |
| `stage.id` | string | Current stage ID |
| `stage.name` | string | Current stage display name |
| `stage.availableActions` | array | Actions available for user input (with trigger descriptions, examples, parameters) |
| `stage.useKnowledge` | boolean | Whether knowledge base is active |
| `stage.enterBehavior` | string | `'generate_response'` or `'await_user_input'` |
| `stage.metadata` | object | Custom stage metadata |

---

## Effect Execution Order

When multiple actions fire simultaneously, all their effects are pooled and executed in a **global priority order**. This ensures predictable behavior regardless of which action an effect came from.

```
1. call_webhook       ← Fetch external data first
2. call_tool          ← Run LLM-powered tools
3. modify_variables   ← Update stage variables (with value resolution)
4. modify_user_profile ← Update user profile (with value resolution)
5. modify_user_input  ← Transform the user's input
6. run_script         ← Run custom logic (can access everything above)
7. generate_response  ← Flag AI response generation (or use prescripted response)
8. end_conversation   ← Graceful termination
9. abort_conversation ← Immediate termination
10. go_to_stage       ← Stage navigation (always last)
```

This ordering is intentional:
- **Data fetching** (webhooks, tools) happens first so results are available to scripts and templates
- **State mutations** (variables, profiles, input) happen in the middle
- **Flow control** (response generation, conversation ending, stage changes) happens last
- **Stage navigation** is always last because it triggers a full stage reload with its own lifecycle

---

## WebSocket Commands

Beyond regular user input, WebSocket clients can send commands to interact with conversations programmatically:

| Command | Purpose |
|---------|---------|
| `go_to_stage` | Navigate to a specific stage (triggers full stage transition lifecycle) |
| `set_var` | Set a variable value on a specific stage |
| `get_var` | Get a variable value from a specific stage |
| `get_all_vars` | Get all variables from a specific stage |
| `run_action` | Execute a named action with parameters (records a `command` event) |
| `call_tool` | Invoke a tool directly with parameters (returns multimodal content blocks) |

These commands enable rich client integrations where the UI can drive conversation flow, inspect state, and invoke tools independently of user speech/text input.

---

## Session Settings

When authenticating, clients can provide `sessionSettings` to configure their session behavior:

| Setting | Default | Description |
|---------|---------|-------------|
| `sendVoiceInput` | `true` | Whether the client can send voice input |
| `sendTextInput` | `true` | Whether the client can send text input |
| `receiveVoiceOutput` | `true` | Whether the client wants to receive voice output |
| `receiveTranscriptionUpdates` | `true` | Whether the client wants interim transcription updates for voice input and output |
| `receiveEvents` | `true` | Whether the client wants to receive all conversation events |

This allows clients to opt out of features they don't need — for example, a text-only client can set `sendVoiceInput: false` and `receiveVoiceOutput: false` to skip all audio processing.

---

## Multimodal Support

Nexus supports multimodal content across several features:

- **Tool parameters** can have `image`, `image[]`, `audio`, or `audio[]` types
- **Tool input/output** supports `text`, `image`, or `multi-modal` modes
- **LLM content blocks** can be `text`, `image`, or `json`
- **WebSocket output** includes `send_ai_image_output` and `send_ai_audio_output` messages for non-text responses
- **Tool and action results** via WebSocket return arrays of multimodal content blocks

Image parameters include `data` (base64), `mimeType`, and optional dimension metadata. Audio parameters include `data` (base64), `format`, `mimeType`, and optional sample rate/channel metadata.

---

## Conversation Events

Every significant occurrence during a conversation is recorded as a typed event:

| Event Type | When Recorded |
|------------|--------------|
| `message` | User or assistant message (includes original and modified text) |
| `classification` | Classifier results with matched actions |
| `transformation` | Context transformer execution with applied fields |
| `action` | Action execution with effects list |
| `command` | WebSocket client command execution |
| `tool_call` | Tool invocation with parameters, result, and success status |
| `conversation_start` | Conversation creation with initial stage and variables |
| `conversation_resume` | Conversation resumed (with previous status) |
| `conversation_end` | Graceful conversation end with reason |
| `conversation_aborted` | Conversation aborted with reason |
| `conversation_failed` | Conversation failure with error reason |
| `jump_to_stage` | Stage transition (with from/to stage IDs) |

Events are correlated via `inputTurnId` and `outputTurnId` for linking related events within a single turn. If `receiveEvents` is enabled in session settings, events are also pushed to the client in real-time via the `conversation_event` WebSocket message.

---

## Administration and Operations

### RBAC Permissions

Nexus uses role-based access control with fine-grained permissions. Permissions follow an `entity:action` pattern:

| Role | Description |
|------|-------------|
| `super_admin` | Full access to all resources and operations |
| `content_manager` | CRUD on content entities (projects, stages, personas, etc.) |
| `support` | User and issue management, project and conversation viewing |
| `developer` | Read-only access plus system configuration |
| `viewer` | Read-only access across all entities |

Security is enforced at both the **controller layer** (HTTP middleware) and the **service layer** (method-level checks), providing defense-in-depth.

### Cross-Instance Migration

The **MigrationService** enables exporting and importing project configurations between Nexus instances:

- **Export** — Generate a bundle containing a project and all its entities (stages, personas, classifiers, etc.)
- **Import** — Apply a bundle to create or update entities on the target instance
- **Pull** — Fetch a project bundle directly from a remote Nexus instance (via **Environments**)
- **Preview** — Dry-run an import to see what would change before committing
- **Compatibility** — Schema hash comparison ensures source and target instances are compatible

Environments store remote server credentials (`url`, `login`, `password`) and are used as pull targets.

### Issue Tracking

Project-scoped issue/bug tracking with:

| Field | Purpose |
|-------|---------|
| `severity` | Issue severity level |
| `category` | Issue category |
| `bugDescription` | Description of the bug |
| `expectedBehaviour` | What should happen instead |
| `sessionId` / `eventIndex` | Link to specific conversation events |
| `environment` / `buildVersion` | Deployment context |
| `status` | Current issue status |

### API Versioning

The `GET /version` endpoint returns:
- `restSchemaHash` — SHA-256 hash (12 hex chars) of the OpenAPI spec
- `wsSchemaHash` — SHA-256 hash (12 hex chars) of the WebSocket JSON Schema
- `gitCommit` — Git commit hash from the `GIT_COMMIT` environment variable

These hashes are used by the migration system to verify schema compatibility between instances.

### Audit Logging

All write operations on entities are recorded in the audit log with:
- `userId` — Who performed the action
- `action` — What was done (create, update, delete)
- `entityId` / `entityType` — Which entity was affected
- `oldEntity` / `newEntity` — Before/after snapshots for change tracking

---

## Design Patterns and Best Practices

### Multi-Stage Conversation Flow

Design conversations as a graph of stages. Use `go_to_stage` effects to navigate between them:

```
[Greeting Stage] ──go_to_stage──► [Main Menu Stage]
                                       │
                        ┌───────────────┼───────────────┐
                        ▼               ▼               ▼
                 [Order Stage]   [Support Stage]   [FAQ Stage]
                        │               │
                        ▼               ▼
                 [Confirmation]  [Ticket Created]
                        │               │
                        └───────┬───────┘
                                ▼
                        [Goodbye Stage]
                          (end_conversation)
```

### Initialization with `__on_enter`

Use `__on_enter` to set up a stage before the AI speaks:

```json
{
  "__on_enter": {
    "name": "Load User Data",
    "triggerOnUserInput": false,
    "triggerOnClientCommand": false,
    "effects": [
      {
        "type": "call_webhook",
        "url": "https://api.example.com/users/{{userProfile.id}}",
        "method": "GET",
        "resultKey": "userData"
      },
      {
        "type": "modify_variables",
        "modifications": [
          { "variableName": "loaded", "operation": "set", "value": true }
        ]
      }
    ]
  }
}
```

This ensures the webhook data is available in `{{results.webhooks.userData}}` when the stage prompt renders.

### Conditional Actions

Use the `condition` field to show/hide actions based on conversation state:

```json
{
  "confirm_order": {
    "name": "Confirm Order",
    "condition": "vars.orderReady === true && vars.confirmed !== true",
    "triggerOnUserInput": true,
    "classificationTrigger": "User confirms they want to place the order",
    "parameters": [],
    "effects": [
      { "type": "modify_variables", "modifications": [{ "variableName": "confirmed", "operation": "set", "value": true }] },
      { "type": "call_webhook", "url": "https://api.example.com/orders", "method": "POST", "body": { "items": "{{json vars.items}}" }, "resultKey": "orderResult" },
      { "type": "go_to_stage", "stageId": "confirmation_stage" }
    ]
  }
}
```

The `condition` is evaluated as JavaScript in the isolated VM with access to `vars`, `userProfile`, etc. The action only appears in the classifier's list when the condition is truthy.

### Combining Webhooks with Variables

A common pattern is to fetch data, store it in variables, and use it in the prompt:

1. **`__on_enter`**: `call_webhook` to fetch data → `run_script` to extract relevant fields into `vars`
2. **Stage prompt**: Reference `{{vars.extractedField}}` in the system prompt
3. **User action**: `call_webhook` to submit data, using `{{vars.field}}` in the request body

### Cross-Stage Variable Access

Use `{{stageVars.otherStageId.variableName}}` in templates to read variables from other stages. This enables passing data between stages without webhooks:

1. **Stage A** sets `vars.selectedProduct = "Widget Pro"`
2. **Stage B** prompt references `{{stageVars.stageA.selectedProduct}}`

### Transformer + Watched Variables Pattern

Use context transformers with watched variables for reactive data extraction:

1. **Transformer** extracts structured fields from free-form user input (e.g., name, email, phone)
2. **Action** with `triggerOnTransformation: true` and `watchedVariables: { "email": "new" }` fires when the transformer first extracts an email
3. **Effect** calls a webhook to validate the email, stores result in a variable

### Parameter Extraction

Define parameters on actions to extract structured data from user input:

```json
{
  "book_flight": {
    "name": "Book Flight",
    "triggerOnUserInput": true,
    "classificationTrigger": "User wants to book a flight",
    "parameters": [
      { "name": "destination", "type": "string", "description": "Destination city", "required": true },
      { "name": "date", "type": "string", "description": "Travel date", "required": true },
      { "name": "passengers", "type": "number", "description": "Number of passengers", "required": false }
    ],
    "effects": [
      { "type": "modify_variables", "modifications": [
        { "variableName": "destination", "operation": "set", "value": "{{actions.book_flight.parameters.destination}}" },
        { "variableName": "date", "operation": "set", "value": "{{actions.book_flight.parameters.date}}" }
      ]},
      { "type": "generate_response" }
    ]
  }
}
```

The classifier LLM will extract `destination`, `date`, and `passengers` from the user's message and make them available in `actions.book_flight.parameters.*`.

### Prescripted Response Pattern

Use prescripted responses for deterministic outputs:

```json
{
  "greet_user": {
    "name": "Greet User",
    "triggerOnUserInput": true,
    "classificationTrigger": "User says hello or greets",
    "effects": [
      {
        "type": "generate_response",
        "responseMode": "prescripted",
        "prescriptedSelectionStrategy": "random",
        "prescriptedResponses": [
          "Hello! How can I help you today?",
          "Hi there! What can I do for you?",
          "Welcome! How may I assist you?"
        ]
      }
    ]
  }
}
```

### Fallback Handling

Define `__on_fallback` to handle unrecognized input gracefully:

```json
{
  "__on_fallback": {
    "name": "Unrecognized Input",
    "triggerOnUserInput": false,
    "triggerOnClientCommand": false,
    "effects": [
      {
        "type": "run_script",
        "code": "vars.fallbackCount = (vars.fallbackCount || 0) + 1; if (vars.fallbackCount >= 3) { vars.needsHelp = true; }"
      },
      { "type": "generate_response" }
    ]
  }
}
```

The stage prompt can then include:

```handlebars
{{#if vars.needsHelp}}
The user seems confused. Offer to connect them with a human agent.
{{/if}}
```

---

## Related Documentation

- [ENTITIES.md](./ENTITIES.md) — Full database entity schema reference
- [TEMPLATING.md](./TEMPLATING.md) — Handlebars templating guide with helpers and examples
- [SCRIPTING.md](./SCRIPTING.md) — JavaScript scripting in isolated VM environments
- [SPECIAL_ACTIONS.md](./SPECIAL_ACTIONS.md) — Lifecycle actions (`__on_enter`, `__on_leave`, `__on_fallback`)
- [LLM-SETTINGS.md](./LLM-SETTINGS.md) — LLM provider configuration (reasoning, thinking modes)
- [WEBSOCKET.md](./WEBSOCKET.md) — WebSocket API reference for client integration
- [AUTHENTICATION.md](./AUTHENTICATION.md) — Authentication and authorization guide

---

<sub>**Nexus Backend** v0.1.0 · Generated 2025-02-25 · Commit `8e997e8` · This document reflects the current state of the codebase and may change as features evolve.</sub>
