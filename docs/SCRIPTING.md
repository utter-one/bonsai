# IsolatedScriptExecutor Scripting Guide

This guide explains how to write JavaScript code that runs securely in the IsolatedScriptExecutor VM environment. These scripts are executed as part of the `run_script` effect in stage actions and global actions.

## Overview

Scripts run in a sandboxed isolated-vm environment with:
- **16MB memory limit** - Prevents memory exhaustion
- **5-second timeout** - Prevents infinite loops
- **No Node.js APIs** - No access to filesystem, network, or modules
- **Full conversation context** - Read and modify conversation state

## Security & Limitations

### What You CAN Do
✅ Read and modify stage variables (`vars`)  
✅ Read and modify user profile data (`userProfile`)  
✅ Read and modify user input (`userInput`)  
✅ Read conversation history and action results  
✅ Use standard JavaScript (ES5/ES6 features)  
✅ Use `console.log()`, `console.error()`, `console.warn()`  
✅ Perform calculations and string operations  

### What You CANNOT Do
❌ Import modules (`require()`, `import`)  
❌ Access filesystem or network  
❌ Use Node.js built-in modules  
❌ Access global process or environment variables  
❌ Execute shell commands  
❌ Use async/await or Promises  

## Available Context Variables

All scripts have access to these **read-only** context variables:

| Variable | Type | Description |
|----------|------|-------------|
| `conversationId` | string | Unique ID of the current conversation |
| `stageId` | string | ID of the current stage |
| `history` | Array | Conversation message history with `role` and `content` |
| `actions` | Object | Results from executed actions |
| `results` | Object | Results from webhooks and tools |
| `originalUserInput` | string \| null | Original unmodified user input |

### Mutable Context Variables

These variables can be **read and modified**:

| Variable | Type | Description |
|----------|------|-------------|
| `vars` | Object | Stage variables (changes persist to conversation) |
| `userProfile` | Object | User profile data (changes persist to conversation) |
| `userInput` | string \| null | Current user input (changes affect current turn only) |

**Important:** Changes to `vars`, `userProfile`, and `userInput` are automatically copied back to the main conversation context after script execution.

## Examples

### Example 1: Basic Variable Manipulation

```javascript
// Increment a counter
if (vars.visitCount) {
  vars.visitCount = vars.visitCount + 1;
} else {
  vars.visitCount = 1;
}

// Set a timestamp
vars.lastVisit = new Date().toISOString();

console.log('User has visited', vars.visitCount, 'times');
```

### Example 2: Conditional Logic Based on History

```javascript
// Count how many times user said "help"
var helpCount = 0;
for (var i = 0; i < history.length; i++) {
  if (history[i].role === 'user' && history[i].content.toLowerCase().includes('help')) {
    helpCount++;
  }
}

vars.needsAssistance = helpCount > 2;
console.log('User asked for help', helpCount, 'times');
```

### Example 3: User Profile Updates

```javascript
// Update user preferences based on conversation
if (userInput && userInput.toLowerCase().includes('email')) {
  userProfile.preferredContact = 'email';
} else if (userInput && userInput.toLowerCase().includes('phone')) {
  userProfile.preferredContact = 'phone';
}

// Track user engagement
userProfile.lastActive = new Date().toISOString();
userProfile.messageCount = (userProfile.messageCount || 0) + 1;
```

### Example 4: Modify User Input

```javascript
// Sanitize user input - remove profanity
if (userInput) {
  var badWords = ['bad', 'word', 'list'];
  var cleaned = userInput;
  
  for (var i = 0; i < badWords.length; i++) {
    var regex = new RegExp(badWords[i], 'gi');
    cleaned = cleaned.replace(regex, '***');
  }
  
  userInput = cleaned;
}
```

### Example 5: Processing Action Results

```javascript
// Process webhook results
if (results && results.webhooks && results.webhooks.api_call) {
  var apiData = results.webhooks.api_call;
  
  // Store relevant data in variables
  vars.accountBalance = apiData.balance;
  vars.accountStatus = apiData.status;
  vars.lastTransaction = apiData.lastTransaction;
  
  console.log('Account balance:', vars.accountBalance);
}
```

### Example 6: Complex State Management

```javascript
// Multi-step form progress tracking
var currentStep = vars.formStep || 1;
var maxSteps = 5;

// Validate current step is complete
var isStepValid = false;
if (currentStep === 1 && vars.userName) {
  isStepValid = true;
} else if (currentStep === 2 && vars.userEmail) {
  isStepValid = true;
} else if (currentStep === 3 && vars.userPhone) {
  isStepValid = true;
}

// Advance to next step if valid
if (isStepValid && currentStep < maxSteps) {
  vars.formStep = currentStep + 1;
  console.log('Advanced to step', vars.formStep);
} else if (isStepValid && currentStep === maxSteps) {
  vars.formComplete = true;
  console.log('Form completed');
} else {
  console.warn('Step', currentStep, 'validation failed');
}
```

### Example 7: String Processing

```javascript
// Extract and store user name from input
if (userInput) {
  var nameMatch = userInput.match(/my name is (\w+)/i);
  if (nameMatch) {
    userProfile.firstName = nameMatch[1];
    console.log('Extracted name:', userProfile.firstName);
  }
  
  // Store processed input
  vars.lastInput = userInput.toLowerCase().trim();
}
```

### Example 8: Score Calculation

```javascript
// Calculate user engagement score
var score = 0;

// Points for profile completion
if (userProfile.firstName) score += 10;
if (userProfile.email) score += 10;
if (userProfile.phone) score += 10;

// Points for conversation activity
score += Math.min(history.length * 2, 50); // Max 50 points from messages

// Points for completed actions
if (actions && Object.keys(actions).length > 0) {
  score += Object.keys(actions).length * 5;
}

vars.engagementScore = score;
console.log('Engagement score:', score);
```

## Best Practices

### 1. Always Initialize Variables
```javascript
// Good - Check before incrementing
vars.counter = (vars.counter || 0) + 1;

// Bad - May result in NaN
vars.counter = vars.counter + 1;
```

### 2. Use Defensive Programming
```javascript
// Good - Safe property access
if (results && results.webhooks && results.webhooks.api) {
  var data = results.webhooks.api;
}

// Bad - May throw errors
var data = results.webhooks.api;
```

### 3. Keep Scripts Simple and Fast
```javascript
// Good - Simple O(n) operation
var count = 0;
for (var i = 0; i < history.length; i++) {
  if (history[i].role === 'user') count++;
}

// Bad - Nested loops may timeout
for (var i = 0; i < 1000; i++) {
  for (var j = 0; j < 1000; j++) {
    // Complex operation
  }
}
```

### 4. Use Console Logging for Debugging
```javascript
console.log('Script started, vars:', JSON.stringify(vars));
console.log('Processing user input:', userInput);
console.warn('Unexpected state:', vars.status);
console.error('Validation failed for field:', fieldName);
```

### 5. Handle Edge Cases
```javascript
// Good - Handle null/undefined
if (userInput && userInput.trim().length > 0) {
  vars.lastInput = userInput.trim();
}

// Bad - May fail on null
vars.lastInput = userInput.trim();
```

## Common Patterns

### State Machine Pattern
```javascript
var state = vars.flowState || 'init';

if (state === 'init') {
  vars.flowState = 'collecting_info';
} else if (state === 'collecting_info' && vars.userName && vars.userEmail) {
  vars.flowState = 'confirming';
} else if (state === 'confirming' && vars.confirmed) {
  vars.flowState = 'complete';
}
```

### Validation Pattern
```javascript
var errors = [];

if (!vars.email || !vars.email.includes('@')) {
  errors.push('Invalid email');
}

if (!vars.phone || vars.phone.length < 10) {
  errors.push('Invalid phone');
}

vars.validationErrors = errors;
vars.isValid = errors.length === 0;
```

### Data Aggregation Pattern
```javascript
var userMessages = [];
for (var i = 0; i < history.length; i++) {
  if (history[i].role === 'user') {
    userMessages.push(history[i].content);
  }
}

vars.userMessageCount = userMessages.length;
vars.lastUserMessage = userMessages[userMessages.length - 1] || null;
```

## Debugging

When scripts fail, check the logs for:
- `Running script in isolated VM` - Script execution started
- `[Script Console]` - Your console.log/error/warn output
- `Script executed successfully in isolated VM` - Success with variable update count
- `Failed to execute script in isolated VM` - Error with details

Common errors:
- **Timeout** - Script took longer than 5 seconds (simplify logic)
- **Memory limit exceeded** - Script used more than 16MB (reduce data processing)
- **Syntax error** - JavaScript syntax is invalid (check code carefully)
- **ReferenceError** - Trying to access undefined variables

## Testing Scripts

Test your scripts with different scenarios:

1. **Empty state** - New conversation with no variables
2. **Partial state** - Some variables set, others undefined
3. **Edge cases** - null/undefined inputs, empty arrays, zero values
4. **Error cases** - Invalid data, missing properties
5. **Long conversations** - Many history items to test performance

## Integration with Effects

Scripts are part of the `run_script` effect and execute in priority order with other effects:

**Effect Priority Order:**
1. `end_conversation`, `abort_conversation`
2. `go_to_stage`
3. `run_script` ← Your script runs here
4. `modify_variables`
5. `modify_user_input`
6. `modify_user_profile`
7. `call_tool`, `call_webhook`, `generate_response`

Changes made in scripts are available to subsequent effects and the conversation flow.

## See Also

- [Templating Guide](./TEMPLATING.md) - For rendering templates with conversation context
- [Global Actions](./ENTITIES.md#globalaction) - Define actions with run_script effects
- [Stage Actions](./ENTITIES.md#stageaction) - Stage-specific actions with scripts