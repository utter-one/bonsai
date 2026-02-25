# Scripting

Nexus Backend supports executing custom JavaScript within conversation actions via the `run_script` effect. Scripts run in a secure, isolated sandbox with strict resource limits.

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
| `stageId` | Read-only | Current stage ID |
| `history` | Read-only | Conversation message history |
| `actions` | Read-only | Matched action results |
| `originalUserInput` | Read-only | Original unmodified user input |
| `results` | Read-only | Results from tools, webhooks, etc. |
| `console` | — | `console.log()`, `console.error()`, `console.warn()` |

## Modifying State

Scripts can modify three mutable globals. Changes persist after script execution:

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

// Modify arrays
vars.history = vars.history || [];
vars.history.push("Step completed at " + new Date().toISOString());
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
