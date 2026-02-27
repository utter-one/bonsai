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
| `classificationTrigger` | Label the classifier outputs to match this action |
| `overrideClassifierId` | Use a specific classifier instead of the stage default |
| `parameters` | Parameters extracted by the classifier when triggering |
| `effects` | Ordered array of effects to execute |
| `examples` | Example user phrases (included in classifier prompt) |
| `watchedVariables` | Map of variable paths to trigger conditions (`new`, `changed`, `removed`) |
| `metadata` | Arbitrary JSON |

## Lifecycle Actions

Stages support three reserved lifecycle actions with special names (prefixed with `__`):

### `__on_enter`

Runs when the conversation enters this stage — either at the start of a conversation or via a `go_to_stage` effect. Executes **before** the `enterBehavior` (generate response or await input).

Restricted effects: cannot use `end_conversation`, `abort_conversation`, or `go_to_stage`.

### `__on_leave`

Runs when the conversation is about to leave this stage (before loading the new stage). Useful for cleanup or persisting state.

Restricted effects: cannot use `go_to_stage` or `generate_response`.

### `__on_fallback`

Runs when the classifier found no matching user-triggered action. Acts as the default behavior for unrecognized input. Has no effect restrictions.

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

### `run_script`

Executes JavaScript in a secure isolated sandbox. See [Scripting](./scripting) for details.

```json
{
  "type": "run_script",
  "script": "vars.retryCount = (vars.retryCount || 0) + 1; if (vars.retryCount >= 3) { vars.escalate = true; }"
}
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
  "operations": [
    { "op": "set", "path": "status", "value": "verified" },
    { "op": "reset", "path": "retryCount" },
    { "op": "add", "path": "history", "value": "step completed" },
    { "op": "remove", "path": "pendingItems", "value": "item-1" }
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
  "operations": [
    { "op": "set", "path": "preferredLanguage", "value": "es" }
  ]
}
```

### `call_tool`

Invokes an LLM-powered tool. See [Tools](./tools).

```json
{
  "type": "call_tool",
  "toolId": "sentiment-analyzer",
  "parameters": { "text": "{{userInput}}" }
}
```

### `call_webhook`

Makes an HTTP request to an external service:

```json
{
  "type": "call_webhook",
  "method": "POST",
  "url": "https://api.example.com/orders/{{vars.orderId}}",
  "headers": { "Authorization": "Bearer {{constants.apiToken}}" },
  "body": { "action": "check_status" },
  "resultKey": "orderStatus"
}
```

The response is stored under `context.results.webhooks.<resultKey>` and accessible in subsequent effects and prompts.

### `generate_response`

Explicitly triggers AI response generation. Two modes:

**Generated** (LLM produces the response):
```json
{ "type": "generate_response", "mode": "generated" }
```

**Prescripted** (predefined text, no LLM call):
```json
{
  "type": "generate_response",
  "mode": "prescripted",
  "responses": ["Welcome! How can I help?", "Hi there! What can I do for you?"],
  "selectionStrategy": "random"
}
```

Selection strategies: `random` (pick randomly) or `round_robin` (cycle through).

## Execution Flow

When a user sends input, the system:

1. Runs all classifiers in parallel to identify matching actions
2. Runs all context transformers in parallel to extract structured data
3. Deduplicates matched actions across classifiers
4. If no actions match, executes `__on_fallback` (if defined)
5. Executes all matched actions' effects sequentially
6. Applies the combined outcome (variable changes, stage navigation, response generation)

Effects within a single action run in order, and their results can be used by subsequent effects. If any effect triggers `end_conversation`, `abort_conversation`, or `go_to_stage`, it takes effect after all current effects complete.
