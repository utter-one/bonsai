# Stages

A **Stage** represents a distinct phase in a conversation. Stages are the central orchestration entity — they tie together agents, classifiers, transformers, actions, knowledge, and providers into a coherent conversational experience.

## Structure

| Field | Description |
|---|---|
| `id` | Unique identifier (within project) |
| `projectId` | Parent project |
| `name` | Display name |
| `description` | Optional description |
| `prompt` | System prompt (Handlebars template) |
| `agentId` | Referenced agent for AI personality and voice |
| `llmProviderId` | LLM provider for response generation |
| `llmSettings` | LLM-specific settings (model, temperature, etc.) |
| `enterBehavior` | What happens when entering this stage |
| `useKnowledge` | Whether to include knowledge base in classification |
| `knowledgeTags` | Filter knowledge categories by tags |
| `useGlobalActions` | Whether global actions are available |
| `globalActions` | Specific global action IDs to include |
| `defaultClassifierId` | Primary classifier for user input |
| `transformerIds` | Context transformers to run on each input |
| `variableDescriptors` | Schema of typed variables for this stage |
| `actions` | Map of action definitions |
| `metadata` | Arbitrary JSON |
| `tags` | Searchable labels for organization |
| `archived` | Whether the stage is archived |
| `version` | Optimistic locking version |

## Enter Behavior

When a conversation enters a stage (at start or via `go_to_stage`), the `enterBehavior` controls what happens:

- **`generate_response`** (default) — The AI immediately generates a response using the stage prompt. This is useful for greeting messages or informational stages.
- **`await_user_input`** — The system waits for the user to speak or type first. This is useful when the user should initiate the interaction.

## System Prompt

The `prompt` field is a [Handlebars template](./templating) that defines the AI's system prompt for this stage. It has access to:

- <code v-pre>{{agent}}</code> — Agent personality prompt (**must be explicitly placed — see warning below**)
- <code v-pre>{{vars.&lt;key&gt;}}</code> — Stage variables
- <code v-pre>{{userProfile.&lt;key&gt;}}</code> — User profile data
- <code v-pre>{{consts.&lt;key&gt;}}</code> — Project-level constants
- <code v-pre>{{history}}</code> — Conversation history (auto-injected)
- <code v-pre>{{faq}}</code> — Knowledge base results (**must be explicitly placed — see warning below**)

> **Warning — `agent` is not auto-injected.** The agent linked via `agentId` defines the AI's personality, but that personality text only reaches the LLM if you explicitly write <code v-pre>{{agent}}</code> somewhere in your stage prompt. Without it, the agent's `prompt` field has no effect on the conversation.

> **Warning — `faq` is not auto-injected.** When knowledge classification matches FAQ items, those results are only visible to the LLM if you explicitly include <code v-pre>{{faq}}</code> in your stage prompt. Without it, matched knowledge results are silently discarded.

Example prompt:

```handlebars
{{agent}}

You are a customer service agent for {{consts.companyName}}.
The customer's name is {{userProfile.name}}.

{{#if (exists vars.issue)}}
The customer is experiencing: {{vars.issue}}
Help them resolve this issue step by step.
{{else}}
Ask the customer what they need help with today.
{{/if}}

{{#hasItems faq}}
Relevant knowledge:
{{#each faq}}
Q: {{this.question}}
A: {{this.answer}}
{{/each}}
{{/hasItems}}
```

## Variable Descriptors

Stages define a typed schema for their variables using `variableDescriptors`. These descriptors tell the system (and LLM) what data is expected:

```json
[
  { "name": "customerName", "type": "string", "isArray": false },
  { "name": "issueCategory", "type": "string", "isArray": false },
  { "name": "orderIds", "type": "string", "isArray": true },
  {
    "name": "address",
    "type": "object",
    "isArray": false,
    "objectSchema": [
      { "name": "street", "type": "string", "isArray": false },
      { "name": "city", "type": "string", "isArray": false },
      { "name": "zip", "type": "string", "isArray": false }
    ]
  }
]
```

Supported types: `string`, `number`, `boolean`, `object`. Any type can be an array via `isArray: true`. Objects can nest via `objectSchema`.

Variables are persisted in the conversation's `stageVars` and are available in Handlebars templates, action conditions, and scripts.

## References

A stage references several other entities:

- **Agent** (`agentId`) — Defines the AI's personality prompt and TTS voice settings. See [Agents](./agents).
- **LLM Provider** (`llmProviderId` / `llmSettings`) — The model used for generating responses. See [Providers](./providers).
- **Classifier** (`defaultClassifierId`) — Classifies user input into action triggers. See [Classifiers](./classifiers).
- **Context Transformers** (`transformerIds`) — Populate stage variables on each turn: extract structured data, generate prompt fragments, or write flow-control flags. See [Context Transformers](./context-transformers).
- **Global Actions** (`globalActions`) — Reusable actions available in this stage. See [Global Actions](./global-actions).
- **Knowledge** (`knowledgeTags`) — FAQ categories included in classification. See [Knowledge](./knowledge).

## Stage Navigation

Conversations move between stages via the `go_to_stage` effect. When navigating:

1. The `__on_leave` lifecycle action runs on the current stage (if defined)
2. The new stage is loaded with all its providers, classifiers, and transformers
3. The `__on_enter` lifecycle action runs on the new stage (if defined)
4. The new stage's `enterBehavior` determines what happens next

See [Actions & Effects](./actions-and-effects) for details on lifecycle actions and the `go_to_stage` effect.

## Cloning

Stages can be cloned to create copies with optional custom `id` and `name`. The clone inherits all configuration from the source stage.
