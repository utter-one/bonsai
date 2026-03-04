# Scripting

Bonsai Backed supports executing custom JavaScript within conversation actions via the `run_script` effect. Scripts run in a secure, isolated sandbox with strict resource limits.

## Sandbox Environment

Scripts execute in **isolated-vm**, a V8 isolate-based sandbox that provides:

- **Memory limit** — 16 MB per execution
- **Time limit** — 5 seconds per execution
- **No Node.js APIs** — No `require`, `fs`, `http`, `process`, etc.
- **No network access** — Scripts cannot make HTTP calls
- **No filesystem access** — Scripts cannot read or write files

## Available Globals

Scripts have access to these global variables:

| Variable | Access | Description |
|---|---|---|
| `vars` | Read/Write | Current stage variables |
| `userProfile` | Read/Write | End user's profile data |
| `userInput` | Read/Write | Current user input text (string) |
| `conversationId` | Read-only | Current conversation ID |
| `projectId` | Read-only | Current project ID |
| `stageId` | Read-only | Current stage ID |
| `stage` | Read-only | Full stage object: `id`, `name`, `availableActions`, `metadata`, `enterBehavior`, `useKnowledge` |
| `history` | Read-only | Conversation message history |
| `actions` | Read-only | Matched action results and their parameters |
| `originalUserInput` | Read-only | Original unmodified user input |
| `results` | Read-only | Results from tools and webhooks |
| `time` | Read-only | Rich time context: `iso`, `date`, `time`, `dayOfWeek`, `timezone`, `calendar`, `anchor`, etc. |
| `userInputSource` | Read-only | Input channel: `'text'` \| `'voice'` \| `null` |
| `consts` | Read-only | Project-level constants (from project settings) |
| `stageVars` | Read-only | Variables for all stages, keyed by stage ID |
| `events` | Read-only | All conversation events in chronological order (messages, actions, stage transitions, etc.) |
| `console` | — | `console.log()`, `console.error()`, `console.warn()` |

## Modifying State

Scripts can modify three mutable globals. Changes persist after script execution.

> **Key deletion** — Assigning new properties and deleting existing ones (`delete vars.foo`) both work correctly. The entire object is replaced after each script run.

### Stage Variables

```javascript
// Set a variable
vars.retryCount = (vars.retryCount || 0) + 1;

// Set nested objects
vars.order = {
  id: "ORD-123",
  status: "pending",
  items: ["Widget A", "Widget B"]
};
```

### User Profile

```javascript
userProfile.preferredLanguage = "es";
userProfile.lastInteraction = new Date().toISOString();
```

### User Input

```javascript
// Modify what the LLM sees as user input
userInput = userInput.toLowerCase().trim();

// Add context
userInput = "Context: order " + vars.orderId + ". User says: " + userInput;
```

## Reading Context

```javascript
// Access conversation history
const lastMessage = history[history.length - 1];

// Check classification results
const matchedActions = actions;

// Access webhook/tool results
const orderData = results.webhooks?.orderLookup;

// Current stage metadata
const isBookingStage = stage.name === 'Booking';
const availableActionNames = stage.availableActions.map(a => a.name);

// Distinguish voice vs text input
if (userInputSource === 'voice') {
  userInput = userInput.toLowerCase();
}

// Time-based logic
const hour = parseInt(time.hour, 10);
const isBusinessHours = time.dayOfWeek !== 'Saturday' && time.dayOfWeek !== 'Sunday' && hour >= 9 && hour < 17;
vars.isBusinessHours = isBusinessHours;

// Cross-stage variable access
const prevStepData = stageVars?.['stage-id-here']?.someField;

// Project-level constants
const companyName = consts.companyName;
```

## Utility Functions

The sandbox provides a set of pure utility functions:

### `uuid()`

Generate a random UUID v4.

```javascript
vars.correlationId = uuid(); // e.g. '3b1f8c2d-4e5a-6b7c-8d9e-0f1a2b3c4d5e'
```

### `formatDate(iso, locale?, options?)`

Format an ISO date string using [`Intl.DateTimeFormat`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat). `locale` defaults to the runtime locale; `options` accepts any `Intl.DateTimeFormat` options object.

```javascript
// Short date in Polish
const label = formatDate(time.iso, 'pl-PL', { dateStyle: 'long' });
// e.g. '27 lutego 2026'

// Day and month only
vars.appointmentLabel = formatDate(vars.appointmentDate, 'en-GB', { day: 'numeric', month: 'long' });
// e.g. '14 March'
```

## History Utilities

Five helper functions are available for working with conversation history. They operate purely on the in-memory `history` and `events` arrays — no host calls, no overhead.

### `lastMessage(role?)`

Returns the content of the last message, optionally filtered to `'user'` or `'assistant'`.

```javascript
const last = lastMessage();           // last message regardless of role
const lastUser = lastMessage('user'); // last thing the user said
```

### `messageCount(role?)`

Returns the total number of messages, optionally filtered by role.

```javascript
if (messageCount('user') >= 5) vars.needsEscalation = true;
```

### `historyText(opts?)`

Formats messages as `"User: ...\nAssistant: ..."`. All options are optional.

| Option | Type | Description |
|---|---|---|
| `n` | `number` | Limit to last N messages |
| `role` | `'user'\|'assistant'` | Only include one role |
| `labels` | `{ user?, assistant? }` | Override the `User:` / `Assistant:` prefix strings |

```javascript
vars.recentContext = historyText({ n: 6 });         // last 3 turns
vars.summary = historyText();                       // full conversation

// Custom prefixes
vars.transcript = historyText({ n: 10, labels: { user: 'Customer', assistant: 'Agent' } });
// e.g. "Customer: I need help\nAgent: Sure, let me check..."
```

### `historyContains(substr, role?)`

Case-insensitive substring search across message content.

```javascript
if (historyContains('cancel', 'user')) vars.showCancellationFlow = true;
if (historyContains('error')) vars.errorMentioned = true;
```

### `stageMessages(role?)`

Returns only the messages exchanged since the most recent stage transition (i.e. in the current stage), optionally filtered by role. Returns all history if no stage transition has occurred.

```javascript
const stageUserMsgs = stageMessages('user');
vars.stageRetries = stageUserMsgs.length;
```

## Flow Control

Flow control functions are available in `run_script` effects only. They are silently ignored in action conditions and inline `=` expressions.

All signals are queued and applied after the script finishes — the script always runs to completion first.

### `goToStage(stageId)`

Transition to a different stage after the script.

> **Note:** `goToStage()` is **silently ignored** when called inside a `run_script` effect that belongs to a lifecycle action (`__on_enter` or `__on_leave`). Use it only in regular user-triggered or command-triggered actions.

```javascript
if (vars.retryCount >= 3) {
  goToStage('escalation-stage-id');
}
```

### `endConversation(reason?)`

End the conversation gracefully. Triggers the `on_leave` lifecycle on the current stage.

```javascript
if (vars.taskComplete) {
  endConversation('Task completed successfully');
}
```

### `abortConversation(reason?)`

Abort the conversation immediately.

```javascript
if (vars.fraudDetected) {
  abortConversation('Fraud detection triggered');
}
```

### `prescriptResponse(text)`

Deliver a fixed response to the user, bypassing LLM generation entirely.

```javascript
if (vars.language === 'pl') {
  prescriptResponse('Dziękujemy za kontakt. Do widzenia!');
} else {
  prescriptResponse('Thank you for contacting us. Goodbye!');
}
```

### `suppressResponse()`

Suppress any response generation for this turn. Useful when the script handles the outcome fully through `goToStage` or when a silent state update is needed.

```javascript
// Silently process and transition without generating a response
vars.stepCompleted = true;
goToStage('next-step-id');
suppressResponse();
```

## Events

The `events` array contains all conversation events in chronological order, including messages, actions, stage transitions, tool calls, and more. It is the complete audit trail of the conversation turn.

### `ScriptEvent` shape

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Unique event ID |
| `eventType` | `string` | Event type (see below) |
| `timestamp` | `string` | ISO 8601 timestamp |
| `eventData` | `object` | Event-specific payload |
| `metadata` | `object?` | Optional metadata |

### Event types

| `eventType` | Key `eventData` fields |
|---|---|
| `message` | `role`, `text`, `originalText` |
| `action` | `actionName`, `stageId`, `effects` |
| `tool_call` | `toolId`, `toolName`, `parameters`, `success`, `result?`, `error?` |
| `classification` | `classifierId`, `input`, `actions` |
| `transformation` | `transformerId`, `input`, `appliedFields` |
| `command` | `command`, `parameters?` |
| `jump_to_stage` | `fromStageId`, `toStageId` |
| `conversation_start` | `stageId`, `initialVariables?` |
| `conversation_resume` | `previousStatus`, `stageId` |
| `conversation_end` | `reason?`, `stageId` |
| `conversation_aborted` | `reason`, `stageId` |
| `conversation_failed` | `reason`, `stageId?` |

### Examples

```javascript
// How many times has the current stage been entered?
const jumpsHere = events.filter(
  e => e.eventType === 'jump_to_stage' && e.eventData.toStageId === stageId
);
vars.stageEntryCount = jumpsHere.length;

// Did a specific tool succeed?
const lookup = events.find(
  e => e.eventType === 'tool_call' && e.eventData.toolName === 'customerLookup'
);
vars.lookupSucceeded = lookup?.eventData.success ?? false;

// What stage did we come from?
const lastJump = events.filter(e => e.eventType === 'jump_to_stage').at(-1);
vars.previousStageId = lastJump?.eventData.fromStageId ?? null;
```

## Console Output

Scripts can log messages for debugging. Console output is captured in the conversation events:

```javascript
console.log("Processing order:", vars.orderId);
console.warn("Retry count high:", vars.retryCount);
console.error("Missing required field");
```

## Use Cases

### Conditional Logic

```javascript
if (vars.retryCount >= 3) {
  vars.needsEscalation = true;
  vars.escalationReason = "Max retries exceeded";
}
```

### Data Transformation

```javascript
// Parse and restructure webhook response
const response = results.webhooks?.customerLookup;
if (response) {
  vars.customerName = response.firstName + " " + response.lastName;
  vars.accountTier = response.subscription?.tier || "free";
  vars.isActive = response.status === "active";
}
```

### Input Processing

```javascript
// Extract and normalize data from user input
const numbers = userInput.match(/\d+/g);
if (numbers && numbers.length > 0) {
  vars.extractedNumber = parseInt(numbers[0]);
}

// Clean up user input
userInput = userInput.replace(/[^\w\s]/g, "").trim();
```

### Flow Control Flags

```javascript
// Set flags that conditions in other actions can check
vars.hasCompletedVerification = true;
vars.currentStep = "payment";
vars.allowNavigation = vars.allFieldsFilled && vars.termsAccepted;
```

## Limitations

- **No async/await** — All code must be synchronous
- **No external modules** — Cannot import or require packages
- **No network calls** — Use `call_webhook` effect instead
- **No timers** — `setTimeout`, `setInterval` are not available
- **16 MB memory** — Complex data structures or large strings may hit the limit
- **5 second timeout** — Long-running computations will be terminated

## Best Practices

- **Keep scripts short** — Use scripts for data manipulation, not complex logic
- **Guard against undefined** — Always check if variables exist before accessing them
- **Use effects for external calls** — Scripts handle local state; `call_webhook` and `call_tool` handle external interactions
- **Log for debugging** — Use `console.log()` to track script execution in conversation events
- **Avoid side effects** — Only modify `vars`, `userProfile`, and `userInput`
