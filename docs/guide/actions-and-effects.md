# Actions & Effects

Actions are the primary mechanism for the AI to perform behaviors beyond generating text. Each stage defines a set of actions, and each action contains an ordered list of effects that execute when the action is triggered.

## Action Structure

Each action in the `actions` map has a key (the action ID) and a value with these fields:

| Field | Description |
|---|---|
| `name` | Display name |
| `condition` | Optional JavaScript expression evaluated to determine if the action is active |
| `triggerOnUserInput` | Whether this action can be triggered by user speech/text (default: `true`) |
| `triggerOnClientCommand` | Whether this action can be triggered by a client command |
| `triggerOnTransformation` | Whether this action runs after context transformation |
| `classificationTrigger` | Descriptive label shown to the classifier LLM that tells it when this action should fire; the LLM matches user intent against this label and returns the action **ID** in its response |
| `overrideClassifierId` | Use a specific classifier instead of the stage default |
| `parameters` | Parameters extracted by the classifier when triggering |
| `effects` | Ordered array of effects to execute |
| `examples` | Example user phrases (included in classifier prompt) |
| `watchedVariables` | Map of variable paths to trigger conditions (`new`, `changed`, `removed`, `any`) |
| `metadata` | Arbitrary JSON |

## Stage Lifecycle Actions

Stages support three reserved lifecycle actions with special names (prefixed with `__`):

### `__on_enter`

Runs when the conversation enters this stage — either at the start of a conversation or via a `go_to_stage` effect. Executes **before** the `enterBehavior` (generate response or await input).

Restricted effects: cannot use `end_conversation`, `abort_conversation`, or `go_to_stage`. Calling `goToStage()` inside a `script` tool is also silently ignored.

### `__on_leave`

Runs when the conversation is about to leave this stage (before loading the new stage). Useful for cleanup or persisting state.

Restricted effects: cannot use `go_to_stage` or `generate_response`. Calling `goToStage()` inside a `script` tool is also silently ignored.

### `__on_fallback`

Runs when the classifier found no matching user-triggered action. Acts as the default behavior for unrecognized input. Has no effect restrictions.

## Conversation Lifecycle Actions

In addition to stage-level lifecycle hooks, **global actions** with reserved IDs fire at conversation-level lifecycle events, independent of which stage is active. See [Global Actions — Conversation Lifecycle Hooks](./global-actions#conversation-lifecycle-hooks) for the full reference, restrictions, and use cases.

| Reserved Global Action ID | When it fires |
|---|---|
| `__conversation_start` | Once, after the conversation and first stage are initialised |
| `__conversation_resume` | When a previously-interrupted conversation is resumed |
| `__conversation_end` | When the conversation is gracefully ended |
| `__conversation_abort` | When the conversation is aborted (immediate stop) |
| `__conversation_failed` | When the conversation encounters a fatal error |

There is also a moderation hook:

| Reserved Global Action ID | When it fires |
|---|---|
| `__moderation_blocked` | User input is blocked by content moderation |

See [Global Actions — Content Moderation Hook](./global-actions#content-moderation-hook) for details.

## Trigger Modes

Actions can be triggered in multiple ways:

- **User input** (`triggerOnUserInput: true`) — The classifier analyzes the user's text and matches it to the action's `classificationTrigger`.
- **Client command** (`triggerOnClientCommand: true`) — The client application sends a `run_action` WebSocket command.
- **Transformation** (`triggerOnTransformation: true`) — A context transformer modifies stage variables, and the action's `watchedVariables` matches the change.

## Conditions

The `condition` field accepts a JavaScript expression that evaluates to a boolean. If the condition evaluates to `false`, the action is excluded from the classifier's consideration set. Variables are accessible in conditions:

```javascript
vars.retryCount < 3 && userProfile.tier === 'premium'
```

## Action Parameters

Actions can define parameters that the classifier extracts from user input:

```json
"parameters": [
  {
    "name": "productName",
    "type": "string",
    "description": "The name of the product the user is asking about",
    "required": true
  },
  {
    "name": "quantity",
    "type": "number",
    "description": "How many units",
    "required": false
  }
]
```

Extracted parameters are available in effects via `context.results.actions.<actionId>.<paramName>`.

## Effects

Effects are the building blocks of action behavior. They execute in order within an action.

### `end_conversation`

Gracefully ends the conversation. Optionally generates a final AI response.

```json
{ "type": "end_conversation", "reason": "User's issue has been resolved" }
```

### `abort_conversation`

Immediately ends the conversation without generating any AI response.

```json
{ "type": "abort_conversation", "reason": "Session timeout" }
```

### `go_to_stage`

Navigates to a different stage. Triggers `__on_leave` on the current stage and `__on_enter` on the target stage.

```json
{ "type": "go_to_stage", "stageId": "troubleshooting" }
```

### `modify_user_input`

Replaces the user's input text using a Handlebars template. This modifies what the LLM sees as the user's message.

```json
{
  "type": "modify_user_input",
  "template": "The user wants to know about {{vars.currentTopic}}: {{userInput}}"
}
```

### `modify_variables`

Performs operations on stage variables:

```json
{
  "type": "modify_variables",
  "modifications": [
    { "variableName": "status", "operation": "set", "value": "verified" },
    { "variableName": "retryCount", "operation": "reset" },
    { "variableName": "history", "operation": "add", "value": "step completed" },
    { "variableName": "pendingItems", "operation": "remove", "value": "item-1" }
  ]
}
```

Operations:
- **`set`** — Set a variable to a value
- **`reset`** — Clear a variable
- **`add`** — Append a value to an array
- **`remove`** — Remove a value from an array

### `modify_user_profile`

Same operations as `modify_variables`, but applied to the user's profile instead.

```json
{
  "type": "modify_user_profile",
  "modifications": [
    { "fieldName": "preferredLanguage", "operation": "set", "value": "es" }
  ]
}
```

### `call_tool`

Invokes a tool. The tool's `type` determines both its execution behaviour and when it runs relative to other effects (see [Effect Execution Priority](#effect-execution-priority)). See [Tools](./tools).

```json
{
  "type": "call_tool",
  "toolId": "sentiment-analyzer",
  "parameters": { "text": "{{userInput}}" }
}
```

Results are stored differently depending on the tool type:
- **`smart_function`** and **`script`** tools — stored under `context.results.tools.<toolId>`
- **`webhook`** tools — stored under `context.results.webhooks.<toolId>`

### `generate_response`

Explicitly triggers AI response generation. Two modes:

**Generated** (LLM produces the response):
```json
{ "type": "generate_response", "responseMode": "generated" }
```

**Prescripted** (predefined text, no LLM call):
```json
{
  "type": "generate_response",
  "responseMode": "prescripted",
  "prescriptedResponses": ["Welcome! How can I help?", "Hi there! What can I do for you?"],
  "prescriptedSelectionStrategy": "random"
}
```

Selection strategies: `random` (pick randomly) or `round_robin` (cycle through).

## Effect Execution Priority

Effects from **all** triggered actions are gathered into a single global list, sorted by priority, and then conflict-resolved before execution. Effects within the same priority tier run in the order they appeared across all actions.

| Priority | Effect type |
|---|---|
| 1 | `call_tool` _(webhook tools)_ |
| 2 | `call_tool` _(smart\_function tools)_ |
| 3 | `modify_variables` |
| 4 | `modify_user_profile` |
| 5 | `modify_user_input` |
| 6 | `call_tool` _(script tools)_ |
| 7 | `generate_response` |
| 8 | `end_conversation` |
| 9 | `abort_conversation` |
| 10 | `go_to_stage` |

`call_tool` effects are assigned a priority at runtime based on the referenced tool's `type`: `webhook` tools run at priority 1, `script` tools at priority 6, and `smart_function` tools at priority 2.

### Conflict Resolution

- **Multiple `go_to_stage`** — only the first one (lowest priority index) is kept; the rest are discarded
- **`abort_conversation` + `end_conversation`** — `abort_conversation` wins; `end_conversation` is removed
- **Multiple `modify_user_input`** — all are applied in sequence, each receiving the output of the previous

## Execution Flow

When a user sends input, the system:

1. Runs all classifiers in parallel to identify matching actions
2. Runs all context transformers in parallel to extract structured data
3. Deduplicates matched actions across classifiers
4. If no actions match, executes `__on_fallback` (if defined)
5. Executes all matched actions' effects sequentially
6. Applies the combined outcome (variable changes, stage navigation, response generation)

Effects within a single action run in order, and their results can be used by subsequent effects. If any effect triggers `end_conversation`, `abort_conversation`, or `go_to_stage`, it takes effect after all current effects complete.
