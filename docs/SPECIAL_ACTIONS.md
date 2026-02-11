# Special Actions (Lifecycle Actions)

## Overview

Special actions (also called "lifecycle actions") are reserved system-level actions that execute automatically at specific points in the conversation lifecycle. Unlike regular stage actions that are triggered by user input or commands, special actions are triggered by stage lifecycle events such as entering a stage, leaving a stage, or when no action matches user input.

## Reserved Action Names

Special actions use a double-underscore prefix (`__`) to avoid conflicts with user-defined actions. The system recognizes three special action names:

| Action Name | Trigger Point | Description |
|------------|---------------|-------------|
| `__on_enter` | Stage Entry | Executes when entering a stage, **before** `enterBehavior` logic |
| `__on_leave` | Stage Exit | Executes when leaving a stage, **before** loading the new stage |
| `__on_fallback` | No Match | Executes when no user action matches after classification |

These are defined in [`src/types/actions.ts`](../src/types/actions.ts) as:

```typescript
export const LIFECYCLE_ACTION_NAMES = {
  ON_ENTER: '__on_enter',
  ON_LEAVE: '__on_leave',
  ON_FALLBACK: '__on_fallback',
} as const;
```

## Lifecycle Contexts

Each special action is executed in a specific lifecycle context that determines which effects are allowed. The system enforces these restrictions to prevent logical conflicts and ensure proper conversation flow.

### `on_enter` Context

**When:** Executed when entering a stage (e.g., during conversation start or after `go_to_stage`)

**Allowed Effects:**
- ✅ `call_webhook` - Fetch external data
- ✅ `call_tool` - Call registered tools
- ✅ `modify_variables` - Initialize or update stage variables
- ✅ `modify_user_profile` - Update user profile data
- ✅ `modify_user_input` - Modify user input (if present)
- ✅ `run_script` - Execute custom JavaScript logic

**Restricted Effects:**
- ❌ `end_conversation` - Would interfere with stage initialization
- ❌ `abort_conversation` - Would interfere with stage initialization
- ❌ `go_to_stage` - Would create infinite loops or prevent stage from loading

**Typical Use Cases:**
```json
{
  "name": "Initialize Stage",
  "condition": null,
  "triggerOnUserInput": false,
  "triggerOnClientCommand": false,
  "parameters": [],
  "effects": [
    {
      "type": "modify_variables",
      "modifications": [
        {
          "variableName": "visitCount",
          "operation": "add",
          "value": 1
        }
      ]
    },
    {
      "type": "call_webhook",
      "url": "https://api.example.com/user-data",
      "method": "GET",
      "resultKey": "userData"
    }
  ]
}
```

### `on_leave` Context

**When:** Executed when leaving a stage (before loading the new stage)

**Allowed Effects:**
- ✅ `call_webhook` - Save state to external systems
- ✅ `call_tool` - Execute cleanup tools
- ✅ `modify_variables` - Save final variable state
- ✅ `modify_user_profile` - Update user profile with stage results
- ✅ `modify_user_input` - Transform input before stage transition
- ✅ `run_script` - Execute cleanup logic
- ✅ `end_conversation` - End conversation during stage exit
- ✅ `abort_conversation` - Abort conversation during stage exit

**Restricted Effects:**
- ❌ `go_to_stage` - Would create infinite loops or override the target stage
- ❌ `generate_response` - Response generation is handled by the destination stage

**Typical Use Cases:**
```json
{
  "name": "Cleanup Stage",
  "condition": null,
  "triggerOnUserInput": false,
  "triggerOnClientCommand": false,
  "parameters": [],
  "effects": [
    {
      "type": "call_webhook",
      "url": "https://api.example.com/save-state",
      "method": "POST",
      "body": {
        "stageId": "{{stage.id}}",
        "variables": "{{vars}}"
      },
      "resultKey": "saveResult"
    },
    {
      "type": "modify_variables",
      "modifications": [
        {
          "variableName": "lastExitTime",
          "operation": "set",
          "value": "{{timestamp}}"
        }
      ]
    }
  ]
}
```

### `on_fallback` Context

**When:** Executed when no stage action or global action matches the user's input after classification

**Allowed Effects:**
- ✅ **All effects** - No restrictions

**Typical Use Cases:**
```json
{
  "name": "Handle Unmatched Input",
  "condition": null,
  "triggerOnUserInput": false,
  "triggerOnClientCommand": false,
  "parameters": [],
  "effects": [
    {
      "type": "modify_variables",
      "modifications": [
        {
          "variableName": "unmatchedInputCount",
          "operation": "add",
          "value": 1
        }
      ]
    },
    {
      "type": "run_script",
      "code": "if (context.vars.unmatchedInputCount >= 3) { context.vars.needsHelp = true; }"
    },
    {
      "type": "generate_response"
    }
  ]
}
```

## Effect Restrictions by Lifecycle

The system enforces effect restrictions using the `LIFECYCLE_EFFECT_RESTRICTIONS` map:

```typescript
export const LIFECYCLE_EFFECT_RESTRICTIONS: Record<string, Set<Effect['type']>> = {
  on_enter: new Set(['end_conversation', 'abort_conversation', 'go_to_stage']),
  on_leave: new Set(['go_to_stage', 'generate_response']),
  on_fallback: new Set(), // No restrictions
};
```

During action execution, the [`ActionsExecutor`](../src/services/live/ActionsExecutor.ts) filters out restricted effects:

```typescript
if (lifecycleContext && LIFECYCLE_EFFECT_RESTRICTIONS[lifecycleContext]) {
  const restrictedEffects = LIFECYCLE_EFFECT_RESTRICTIONS[lifecycleContext];
  filteredEffects = allEffects.filter(({ effect, actionName }) => {
    if (restrictedEffects.has(effect.type)) {
      logger.debug(`Ignoring unsupported effect ${effect.type} in lifecycle context ${lifecycleContext}`);
      return false;
    }
    return true;
  });
}
```

## Defining Special Actions

Special actions are defined in the stage's `actions` object, just like regular actions, but using the reserved names:

```json
{
  "id": "stage_onboarding",
  "name": "Onboarding Stage",
  "actions": {
    "__on_enter": {
      "name": "Initialize Onboarding",
      "triggerOnUserInput": false,
      "triggerOnClientCommand": false,
      "effects": [
        {
          "type": "modify_variables",
          "modifications": [
            { "variableName": "onboardingStarted", "operation": "set", "value": true }
          ]
        }
      ]
    },
    "__on_leave": {
      "name": "Complete Onboarding",
      "triggerOnUserInput": false,
      "triggerOnClientCommand": false,
      "effects": [
        {
          "type": "modify_variables",
          "modifications": [
            { "variableName": "onboardingCompleted", "operation": "set", "value": true }
          ]
        }
      ]
    },
    "__on_fallback": {
      "name": "Handle Unmatched Input",
      "triggerOnUserInput": false,
      "triggerOnClientCommand": false,
      "effects": [
        { "type": "generate_response" }
      ]
    }
  }
}
```

**Important Notes:**
- `triggerOnUserInput` and `triggerOnClientCommand` should be set to `false` for special actions
- `classificationTrigger` is not used for special actions
- `parameters` array is not used for special actions (no parameter extraction)
- `condition` can be used to conditionally execute special actions

## Execution Flow

### Stage Entry (`__on_enter`)

1. User starts conversation or navigates to a new stage via `go_to_stage` effect
2. New stage is loaded from database
3. Conversation state and providers are updated
4. **`__on_enter` executes** (if defined)
   - Restricted effects are filtered out
   - Effects execute in priority order
   - Outcome is applied to conversation state
5. If `__on_enter` ended/aborted conversation, stop here
6. Otherwise, `enterBehavior` is processed:
   - `generate_response`: AI generates a response
   - `await_user_input`: Conversation waits for user input

Example from [`ConversationRunner.ts`](../src/services/live/ConversationRunner.ts):

```typescript
// Execute __on_enter lifecycle action if defined
const onEnterAction = this.stageData.stage.actions[LIFECYCLE_ACTION_NAMES.ON_ENTER];
if (onEnterAction) {
  logger.debug('Executing __on_enter lifecycle action');
  const context = await this.contextBuilder.buildContextForConversationStart(this.conversation);
  const enterOutcome = await this.actionsExecutor.executeActions([onEnterAction], context, 'on_enter');
  await this.applyActionOutcome(context, enterOutcome);
  
  // If on_enter ended or aborted conversation, don't proceed
  if (enterOutcome.shouldEndConversation || enterOutcome.shouldAbortConversation) {
    return;
  }
}
```

### Stage Exit (`__on_leave`)

1. Conversation navigates to a different stage (via `go_to_stage` effect or WebSocket command)
2. **`__on_leave` executes on current stage** (if defined)
   - Restricted effects are filtered out
   - Effects execute in priority order
   - Outcome is applied to conversation state
3. If `__on_leave` ended/aborted conversation, stop here
4. Otherwise, new stage is loaded and `__on_enter` executes on new stage

Example from [`ConversationRunner.ts`](../src/services/live/ConversationRunner.ts):

```typescript
// Execute __on_leave lifecycle action if defined on current stage
const onLeaveAction = oldStageData.stage.actions[LIFECYCLE_ACTION_NAMES.ON_LEAVE];
if (onLeaveAction) {
  logger.debug('Executing __on_leave lifecycle action');
  const context = await this.contextBuilder.buildContextForUserInput(oldStageData.conversation, oldStageData.stage, '-', '-');
  const leaveOutcome = await this.actionsExecutor.executeActions([onLeaveAction], context, 'on_leave');
  await this.applyActionOutcome(context, leaveOutcome);
  
  // If on_leave ended or aborted conversation, don't proceed
  if (leaveOutcome.shouldEndConversation || leaveOutcome.shouldAbortConversation) {
    return;
  }
}
```

### No Match Fallback (`__on_fallback`)

1. User provides input (text or voice)
2. Input is classified by all configured classifiers
3. No stage action or global action matches the classification result
4. **`__on_fallback` executes** (if defined)
   - No effect restrictions
   - Effects execute in priority order
   - Outcome is applied to conversation state
5. If no `__on_fallback` is defined, AI generates a generic response

This provides a way to handle unexpected or out-of-scope user input gracefully.

## Limitations and Best Practices

### ❌ Don't Do

1. **Don't use `go_to_stage` in `__on_enter`**
   - Creates infinite loops or prevents the current stage from fully initializing
   - The system filters this effect out automatically

2. **Don't use `end_conversation` or `abort_conversation` in `__on_enter`**
   - Prevents the stage from initializing properly
   - If you need to end early, use a condition-based regular action instead

3. **Don't use `go_to_stage` in `__on_leave`**
   - Overrides the target stage or creates infinite loops
   - The navigation target is already determined; `__on_leave` is for cleanup only

4. **Don't use `generate_response` in `__on_leave`**
   - Response generation is handled by the destination stage's `enterBehavior`
   - The system filters this effect out automatically

5. **Don't try to extract parameters**
   - Special actions don't support parameter extraction
   - Parameters are only for regular actions triggered by user input

### ✅ Do

1. **Use `__on_enter` for initialization**
   - Set default variable values
   - Fetch necessary data from external APIs
   - Initialize counters or flags

2. **Use `__on_leave` for cleanup**
   - Save state to external systems
   - Log analytics events
   - Record final variable values

3. **Use `__on_fallback` for graceful degradation**
   - Track unmatched input counts
   - Provide helpful hints when users are stuck
   - Escalate to human agent if needed

4. **Use conditions to control execution**
   - Special actions support the `condition` field
   - Use it to conditionally execute lifecycle logic
   ```json
   {
     "condition": "vars.isFirstVisit === true",
     "effects": [...]
   }
   ```

5. **Chain effects appropriately**
   - Effects execute in priority order (see [ActionsExecutor](../src/services/live/ActionsExecutor.ts))
   - Use `call_webhook` and `call_tool` early to fetch data
   - Use `modify_variables` to store results
   - Use `run_script` for complex logic
   - Use `generate_response` last if needed

## Technical Implementation

### Definition Location
- Special action names: [`src/types/actions.ts`](../src/types/actions.ts)
- Effect restrictions: [`src/types/actions.ts`](../src/types/actions.ts)

### Execution Location
- Stage entry: [`src/services/live/ConversationRunner.ts`](../src/services/live/ConversationRunner.ts) - `startConversation()` and `goToStage()`
- Stage exit: [`src/services/live/ConversationRunner.ts`](../src/services/live/ConversationRunner.ts) - `goToStage()`
- No match fallback: [`src/services/live/UserInputProcessor.ts`](../src/services/live/UserInputProcessor.ts) - `processUserInput()`

### Effect Filtering
- Executor: [`src/services/live/ActionsExecutor.ts`](../src/services/live/ActionsExecutor.ts) - `executeActions()`
- The executor receives a `lifecycleContext` parameter (`'on_enter' | 'on_leave' | 'on_fallback' | null`)
- Effects are filtered based on the restrictions map before execution
- Filtered effects are logged for debugging

## Examples

### Example 1: User Progress Tracking

```json
{
  "id": "stage_tutorial",
  "name": "Tutorial Stage",
  "actions": {
    "__on_enter": {
      "name": "Track Tutorial Entry",
      "triggerOnUserInput": false,
      "triggerOnClientCommand": false,
      "effects": [
        {
          "type": "modify_user_profile",
          "modifications": [
            {
              "fieldName": "tutorialsCompleted",
              "operation": "add",
              "value": "tutorial_basics"
            }
          ]
        }
      ]
    },
    "__on_leave": {
      "name": "Save Tutorial Progress",
      "triggerOnUserInput": false,
      "triggerOnClientCommand": false,
      "effects": [
        {
          "type": "call_webhook",
          "url": "https://api.example.com/analytics",
          "method": "POST",
          "body": {
            "event": "tutorial_completed",
            "userId": "{{userProfile.id}}",
            "completionTime": "{{timestamp}}"
          },
          "resultKey": "analyticsResult"
        }
      ]
    }
  }
}
```

### Example 2: Conditional Initialization

```json
{
  "id": "stage_personalized",
  "name": "Personalized Experience",
  "actions": {
    "__on_enter": {
      "name": "Fetch User Preferences",
      "condition": "!vars.preferencesLoaded",
      "triggerOnUserInput": false,
      "triggerOnClientCommand": false,
      "effects": [
        {
          "type": "call_webhook",
          "url": "https://api.example.com/preferences/{{userProfile.id}}",
          "method": "GET",
          "resultKey": "userPreferences"
        },
        {
          "type": "modify_variables",
          "modifications": [
            {
              "variableName": "preferencesLoaded",
              "operation": "set",
              "value": true
            }
          ]
        }
      ]
    }
  }
}
```

### Example 3: Fallback with Escalation

```json
{
  "id": "stage_support",
  "name": "Customer Support",
  "actions": {
    "__on_fallback": {
      "name": "Handle Unrecognized Request",
      "triggerOnUserInput": false,
      "triggerOnClientCommand": false,
      "effects": [
        {
          "type": "modify_variables",
          "modifications": [
            {
              "variableName": "fallbackCount",
              "operation": "add",
              "value": 1
            }
          ]
        },
        {
          "type": "run_script",
          "code": "if (context.vars.fallbackCount >= 3) { context.vars.needsHumanAgent = true; }"
        },
        {
          "type": "generate_response"
        }
      ]
    }
  }
}
```

## Related Documentation

- [TEMPLATING.md](./TEMPLATING.md) - Handlebars templating for effects
- [WEBSOCKET.md](./WEBSOCKET.md) - WebSocket commands like `go_to_stage`
- [ENTITIES.md](./ENTITIES.md) - Stage and action entity definitions
- [`src/types/actions.ts`](../src/types/actions.ts) - TypeScript definitions
- [`src/services/live/ActionsExecutor.ts`](../src/services/live/ActionsExecutor.ts) - Effect execution logic
- [`src/services/live/ConversationRunner.ts`](../src/services/live/ConversationRunner.ts) - Lifecycle execution
