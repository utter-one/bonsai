# Global Actions

**Global Actions** are reusable action definitions that exist at the project level and can be shared across multiple stages. They work identically to stage-level actions but are defined once and referenced by ID.

## Structure

| Field | Description |
|---|---|
| `id` | Unique identifier (within project) |
| `projectId` | Parent project |
| `name` | Display name |
| `condition` | Optional JavaScript expression to control activation |
| `triggerOnUserInput` | Whether triggered by user speech/text (default: `true`) |
| `triggerOnClientCommand` | Whether triggered by client commands (default: `false`) |
| `classificationTrigger` | Label the classifier outputs to match this action |
| `overrideClassifierId` | Use a specific classifier instead of the stage default |
| `parameters` | Parameters extracted by the classifier |
| `effects` | Ordered array of effects to execute |
| `examples` | Example user phrases for classifier context |
| `metadata` | Arbitrary JSON |
| `version` | Optimistic locking version |

## Referencing in Stages

Stages control which global actions are available:

- **`useGlobalActions: true`** — Include global actions in this stage's classification
- **`globalActions: ["action-1", "action-2"]`** — Specific global action IDs to include. If empty and `useGlobalActions` is true, all project global actions are available.

## Global vs. Stage Actions

| Aspect | Stage Actions | Global Actions |
|---|---|---|
| Scope | Single stage only | Shared across stages |
| Definition | Inline in stage's `actions` map | Standalone entity in project |
| Lifecycle actions | Supports `__on_enter`, `__on_leave`, `__on_fallback` | Supports `__conversation_start`, `__conversation_resume`, `__conversation_end`, `__conversation_abort`, `__conversation_failed` |
| Best for | Stage-specific behaviors | Cross-cutting behaviors |

## Conversation Lifecycle Hooks

Global actions with reserved IDs act as **conversation-level lifecycle hooks**. They fire at key points in the conversation's lifecycle, independent of which stage is active. Create a global action with one of the reserved IDs below to register the hook.

| Reserved ID | When it fires |
|---|---|
| `__conversation_start` | Once, after the conversation and first stage are initialised |
| `__conversation_resume` | When a previously-interrupted conversation is resumed |
| `__conversation_end` | When the conversation is gracefully ended |
| `__conversation_abort` | When the conversation is aborted (immediate stop) |
| `__conversation_failed` | When the conversation encounters a fatal error |

Only one action per hook type is supported per project. These IDs are reserved and excluded from stage-level global action classification.

### Effect Restrictions

Each lifecycle context restricts effects that would be meaningless or harmful in that context:

| Lifecycle | Restricted effects |
|---|---|
| `__conversation_start` | `end_conversation`, `abort_conversation` |
| `__conversation_resume` | `end_conversation`, `abort_conversation` |
| `__conversation_end` | `go_to_stage`, `generate_response`, `abort_conversation` |
| `__conversation_abort` | `go_to_stage`, `generate_response`, `end_conversation` |
| `__conversation_failed` | `go_to_stage`, `generate_response`, `end_conversation`, `abort_conversation` |

### Use Cases for Lifecycle Hooks

- **`__conversation_start`** — Initialise analytics, set default variables, log a session start
- **`__conversation_resume`** — Restore session state, refresh tokens, notify a backend
- **`__conversation_end`** — Persist conversation summary, send a satisfaction survey, clean up resources
- **`__conversation_abort`** — Log an unexpected exit, flag the session for review
- **`__conversation_failed`** — Send an error alert, trigger fallback notifications

## Content Moderation Hook

A global action with the reserved ID `__moderation_blocked` fires when user input is flagged by the project's content moderation policy.

| Reserved ID | When it fires |
|---|---|
| `__moderation_blocked` | User input is blocked by content moderation |

### Behaviour

- Like all global actions whose name starts with `__`, it is automatically available in every stage — no need to configure `useGlobalActions` or list it explicitly.
- Has **no effect restrictions** — the action can use any effect, including `generate_response`, `end_conversation`, `go_to_stage`, etc.
- If the action is defined, its effects run and the response (if any) is sent to the client. The original input is recorded as `[Content removed by moderation]` in the conversation history.
- If the action is **not** defined, the input is silently replaced with `[Content removed by moderation]` and conversation processing continues as normal.

### Use Cases

- Send a polite "I can't respond to that" message via a prescripted `generate_response`
- Track policy violations with a `call_webhook` or `run_script`
- Increment a strike counter and `go_to_stage` to an escalation flow after repeated violations
- `end_conversation` immediately on severe content flags

## Use Cases

Global actions are ideal for behaviors that should be consistent across multiple stages:

- **Help/Support** — "I need help" triggers the same escalation flow everywhere
- **Exit/Cancel** — "I want to stop" consistently ends the conversation
- **Language switch** — "Speak in Spanish" changes the language across all stages
- **Navigation shortcuts** — "Go back to the main menu" works from any stage
- **Error handling** — Consistent error recovery behavior

## Effects

Global actions support all the same effects as stage actions:

- `end_conversation`, `abort_conversation`
- `go_to_stage`
- `run_script`
- `modify_user_input`, `modify_variables`, `modify_user_profile`
- `call_tool`, `call_webhook`
- `generate_response`

See [Actions & Effects](./actions-and-effects) for detail on each effect type.

## Cloning

Global actions can be cloned to create modified versions — for example, a "soft cancel" (asks for confirmation) vs. "hard cancel" (immediate exit).
