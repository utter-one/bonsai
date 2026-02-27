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
| Lifecycle actions | Supports `__on_enter`, `__on_leave`, `__on_fallback` | Not applicable |
| Best for | Stage-specific behaviors | Cross-cutting behaviors |

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
