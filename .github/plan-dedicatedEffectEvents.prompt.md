# Plan: Dedicated Events for Each Action Effect with Source Action Name

## Summary

Create a dedicated event for every effect type, and add `sourceActionName` to all existing
effect-level events (`tool_call`, `jump_to_stage`, `conversation_end`, `conversation_aborted`).

New event types: `variables_updated`, `user_profile_updated`, `user_input_modified`,
`user_banned`, `visibility_changed`.

## Architecture

`ActionsExecutor` has no channel/DB access. To emit events "exactly where effects are processed",
we inject an `EffectEventCallback` into `executeActions()`:

```
type EffectEventCallback = (type: ConversationEventType, data: ConversationEventData) => Promise<void>
```

`ConversationRunner` binds `this.saveAndSendEvent` and passes it in. `ActionsExecutor` calls it
inline inside each `execute*()` handler right after the effect has been applied.

**Two categories of effects:**
- **Immediate** — work fully inside `executeEffect()`, emit event right there:
  `call_tool`, `modify_variables`, `modify_user_profile`, `modify_user_input`, `ban_user`, `change_visibility`
- **Deferred** — only set a flag; actual state change happens later in ConversationRunner;
  emit event at that later point but carry `sourceActionName` through the outcome:
  `go_to_stage` → `jump_to_stage`, `end_conversation` → `conversation_end`, `abort_conversation` → `conversation_aborted`

---

## Effect → Event Mapping (target state)

| Effect | Event | sourceActionName? | New? |
|---|---|---|---|
| `call_tool` | `tool_call` | add | existing |
| `go_to_stage` | `jump_to_stage` | add (deferred) | existing |
| `end_conversation` | `conversation_end` | add (deferred) | existing |
| `abort_conversation` | `conversation_aborted` | add (deferred) | existing |
| `generate_response` | `message` | out of scope* | existing |
| `change_visibility` | `visibility_changed` | yes | new |
| `modify_variables` | `variables_updated` | yes | new |
| `modify_user_profile` | `user_profile_updated` | yes | new |
| `modify_user_input` | `user_input_modified` | yes | new |
| `ban_user` | `user_banned` | yes | new |

*`generate_response` → `message` is produced by LLM layer, out of scope.

---

## Steps

### Phase 1 — Event schema changes (`src/types/conversationEvents.ts`)

1. Add 5 new entries to `conversationEventTypeSchema` enum:
   `'variables_updated'`, `'user_profile_updated'`, `'user_input_modified'`,
   `'user_banned'`, `'visibility_changed'`

2. Create 5 new Zod event data schemas with JSDoc and `.describe()` on every field:
   - `variablesUpdatedEventDataSchema`: `sourceActionName: string`, `variables: Record<string, ParameterValue>`
   - `userProfileUpdatedEventDataSchema`: `sourceActionName: string`, `profile: Record<string, ParameterValue>`
   - `userInputModifiedEventDataSchema`: `sourceActionName: string`, `modifiedInput: string`
   - `userBannedEventDataSchema`: `sourceActionName: string`, `reason?: string`
   - `visibilityChangedEventDataSchema`: `sourceActionName: string`, `visibility: MessageVisibility`

3. Add `sourceActionName: z.string().describe(...)` to 4 existing schemas:
   `toolCallEventDataSchema`, `jumpToStageEventDataSchema`,
   `conversationEndEventDataSchema`, `conversationAbortedEventDataSchema`

4. Add all 5 new schemas to the `conversationEventDataSchema` union

### Phase 2 — `EffectEventCallback` type + outcome changes (`src/services/live/ActionsExecutor.ts`)

5. Define and export `EffectEventCallback` type at top of file:
   `export type EffectEventCallback = (type: ConversationEventType, data: ConversationEventData) => Promise<void>`

6. Add `emitEvent: EffectEventCallback` parameter to `executeActions()` and thread it to `executeEffect()`
   (and from there to each `execute*()` handler that needs it)

7. Add `sourceActionName?` to `EffectOutcome` for deferred effects, and aggregate fields to
   `ActionsExecutionOutcome`:
   - `goToStageSourceAction?: string`
   - `endConversationSourceAction?: string`
   - `abortConversationSourceAction?: string`

### Phase 3 — Emit events inline in effect handlers (`src/services/live/ActionsExecutor.ts`)

For each **immediate** effect handler, call `emitEvent(...)` right after the effect is applied:

8. `executeModifyUserInput()` — render input, then:
   `emitEvent('user_input_modified', { sourceActionName, modifiedInput })`

9. `executeBanUser()` — ban user, then:
   `emitEvent('user_banned', { sourceActionName, reason: effect.reason })`

10. `executeChangeVisibility()` — then:
    `emitEvent('visibility_changed', { sourceActionName, visibility })`

11. `executeCallTool()` — after tool execution:
    `emitEvent('tool_call', { toolId, toolName, ..., sourceActionName, metadata: { ... } })`
    This replaces the `toolCallEvents` array collection pattern.

12. In `executeEffect()`, after `modifyVariablesExecutor.execute()`:
    `emitEvent('variables_updated', { sourceActionName, variables: context.vars })`

13. In `executeEffect()`, after `modifyUserProfileExecutor.execute()`:
    `emitEvent('user_profile_updated', { sourceActionName, profile: context.userProfile })`

For **deferred** effects, store `actionName` in `EffectOutcome`:

14. `executeEndConversation()` — add `sourceActionName` to returned outcome
15. `executeAbortConversation()` — add `sourceActionName` to returned outcome
16. `executeGoToStage()` — add `sourceActionName` to returned outcome

### Phase 4 — Update ConversationRunner (`src/services/live/ConversationRunner.ts`)

17. Bind `this.saveAndSendEvent` as `EffectEventCallback` and pass to all `executeActions()` call sites (~9)

18. Remove `toolCallEvents` processing from `saveAndSendOutcomeEvents()` — now emitted inline (step 11).
    Simplify or remove `saveAndSendOutcomeEvents()` if nothing else remains.

19. Add `sourceActionName` to `jump_to_stage` event in `goToStage()` using `outcome.goToStageSourceAction`

20. Add `sourceActionName` to `conversation_end` event at its emit site using `outcome.endConversationSourceAction`

21. Add `sourceActionName` to `conversation_aborted` event at its emit site using `outcome.abortConversationSourceAction`

### Phase 5 — Clean up outcome types

22. Remove `toolCallEvents` from `ActionsExecutionOutcome` and `EffectOutcome` — no longer needed

### Phase 6 — WebSocket schema generation + build

23. Import and integrate all 5 new event schemas in `src/scripts/generateWebSocketSchemas.ts`
24. Run `npm run build` to validate and regenerate `schemas/websocket-contracts.json`

---

## Relevant files

- `src/types/conversationEvents.ts` — All event schemas (extend 4, add 5 new)
- `src/services/live/ActionsExecutor.ts` — Add callback param, emit inline in all `execute*()` handlers; clean up `toolCallEvents`
- `src/services/live/ConversationRunner.ts` — Pass bound `saveAndSendEvent` as callback; add `sourceActionName` to deferred events; clean up `saveAndSendOutcomeEvents()`
- `src/scripts/generateWebSocketSchemas.ts` — Schema generation
- `schemas/websocket-contracts.json` — Auto-generated

---

## Verification

1. `npm run build` passes with no TypeScript errors
2. `schemas/websocket-contracts.json` contains all 5 new event types with `sourceActionName`
3. `tool_call`, `jump_to_stage`, `conversation_end`, `conversation_aborted` schemas have `sourceActionName`
4. `saveAndSendOutcomeEvents()` no longer handles `toolCallEvents`
5. `ActionsExecutionOutcome` no longer has `toolCallEvents` field

---

## Decisions

- **Callback injection** (not constructor injection): keeps ActionsExecutor decoupled from
  ConversationService/channel; each `executeActions()` call can use any emitter
- **Immediate vs. deferred split**: go_to_stage/end/abort events remain in ConversationRunner
  (emitted when the state change actually occurs) but carry `sourceActionName` via outcome
- `generate_response` is out of scope — `message` event is produced by the LLM layer
