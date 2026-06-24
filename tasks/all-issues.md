# TypeScript Code Analysis Report

Generated: 2026-05-29

## Summary

| Severity | Count |
|---|---|
| CRITICAL | 16 (7 resolved) |
| HIGH | 283 |
| MEDIUM | 628 |
| LOW | 576 |
| INFO | 133 |
| **Total** | **1628** |

---

## Issues by File

### docs/.vitepress/config.ts

- **INFO** | Line 1: No type assertion or import type check on `withMermaid` return value — if the plugin API changes, the export silently becomes invalid.

- **LOW** | Line 167: Empty `socialLinks: []`. Dead configuration.

- **LOW** | Line 3–173: No search configuration (`themeConfig.search`) — for a large API docs site, explicitly configuring search avoids relying on implicit behavior.

- **MEDIUM** | Line 167: `socialLinks` is an empty array — dead configuration. Either populate it or remove the key.

- **MEDIUM** | Line 3: Missing `defineConfig` wrapper. No compile-time validation of config shape.


### docs/.vitepress/theme/index.ts


No issues found.

### drizzle.config.ts

- **HIGH** | Line 9: Non-null assertion (`!`) on `process.env.DB_CONNECTION_STRING` — if the env var is missing, `undefined` is passed to `dbCredentials.url` and drizzle-kit will crash at runtime with an obscure error. Should validate presence and provide a clear error message.

- **HIGH** | Line 9: `process.env.DB_CONNECTION_STRING!` — non-null assertion produces empty `url` if env var unset.


### src/apiKeyFeatures.ts

- **HIGH** | Lines 7/49-51: JSDoc says null, type uses undefined. Out of sync.

- **LOW** | Line 14, 34: Array contents are manually duplicated from the union types. If a new variant is added to the type but forgotten in the array, there's no compile-time guard.

- **LOW** | Line 14, 34: `ALL_API_KEY_CHANNELS` and `ALL_API_KEY_FEATURES` are mutable `Array<T>` — should be `readonly T[]` or use `as const` to prevent accidental mutation.

- **LOW** | Line 14/34: `ALL_API_KEY_CHANNELS` and `ALL_API_KEY_FEATURES` duplicate union type literals. Can silently diverge.

- **LOW** | Lines 14/34: Explicit `Array<T>` annotations unnecessary.

- **MEDIUM** | Line 14: `ALL_API_KEY_CHANNELS` duplicates type literals.

- **MEDIUM** | Line 7, 50: Documentation states "A null value" means all allowed, but `ApiKeySettings` uses optional properties (`?`), which produce `undefined`, not `null`. The type and its documentation are inconsistent.

- **MEDIUM** | Line 7: Docs say "null value" but type uses optional properties (`?`), resolving to `undefined`. Contradicts actual type.

- **MEDIUM** | Lines 34-46: `ALL_API_KEY_FEATURES` duplicates type literals.


### src/channels/ChannelCatalog.ts

- **HIGH** | Line 49: Throws a plain `Error` instead of a project custom error class. Inconsistent with the error handling convention.

- **HIGH** | Line 49: Uses generic `Error` instead of project's custom error classes. Should throw `NotFoundError`.

- **INFO** | Line 46: No `hasChannel()` method. Callers must use try/catch to check existence.

- **LOW** | Line 29-30: Unnecessary intermediate `entries` array. Could construct Map directly.

- **LOW** | Line 29: The `entries` array is redundant — could inline directly into `new Map()` for brevity.

- **LOW** | Line 58: `getSupportedChannelTypes()` allocates new array every call. Should cache.

- **LOW** | Line 67: `z.ZodObject<any>` loose generic.

- **MEDIUM** | Line 30: No guard against duplicate channel types. If two injected channels return the same string from `getType()`, the second silently overwrites the first with no warning.

- **MEDIUM** | Line 37: `getChannels()` returns live references. Callers can mutate channel state.

- **MEDIUM** | Line 67: Return type `z.ZodObject<any>` uses `any`, defeating type safety.

- **MEDIUM** | Line 67: Return type `z.ZodObject<any>` uses `any`, losing type safety. Should use proper Zod generic.


### src/channels/ChannelHandlerDispatcher.ts

- **HIGH** | Line 33-42: `registerHandlers()` runs in the constructor with no try/catch. If any `handlerFactory()` throws, the entire application crashes at startup.

- **HIGH** | Line 88: `message as any` cast defeats type safety. Should use validated result or generic handler storage.

- **HIGH** | Line 88: `message as any` cast discards all type safety. Should use Zod `.infer` types or generics.

- **HIGH** | Line 92: `context.sendError()` missing `message.correlationId`. Client cannot correlate error to request.

- **INFO** | Line 54: Method returns `Promise<void>` and swallows all errors internally. Callers cannot distinguish success from failure.

- **LOW** | Line 1: `import 'reflect-metadata'` is redundant — already imported at entry points.

- **LOW** | Line 36: Redundant `.get(messageType)`. Entry guaranteed to exist. Use `.entries()` instead.

- **LOW** | Line 67: `issue.path.join('.')` produces empty string when path is empty, resulting in `: validation message` format.

- **LOW** | Line 74: `!context.session.id` check redundant. `Session.id` is required string field.

- **LOW** | Line 92: Missing `correlationId` in catch-all error.

- **MEDIUM** | Line 35-36: Iterates `keys()` then calls `.get()` — redundant. Use `entries()` instead.

- **MEDIUM** | Line 65-71: Redundant validation — message already validated upstream. Unnecessary overhead on hot path.

- **MEDIUM** | Line 67: `issue.path.join('.')` produces empty string for root issues. Malformed error like `: message`.

- **MEDIUM** | Line 69: Error from user-supplied Zod issues could enable log injection or produce long strings.

- **MEDIUM** | Line 80-86: Feature check is skipped when `handler.requiredFeature` is set but `context.session` is falsy.

- **MEDIUM** | Line 88: `message as any` bypasses Zod narrowing.

- **MEDIUM** | Line 91: Error log lacks `messageType` and `correlationId`. Hard to trace in production.

- **MEDIUM** | Line 91: Logs only `error.message`, dropping stack trace, error type, `messageType`, and `correlationId`.

- **MEDIUM** | Line 92: `context.sendError(errorMessage)` omits `correlationId`, breaking request tracing.


### src/channels/ClientMessageHandlerContext.ts

- **HIGH** | Line 10: `send` accepts `message: any` — loses all type safety. Should use discriminated union.

- **HIGH** | Line 10: `send` parameter uses `any` type for `message`, losing all type safety.

- **INFO** | Line 8: Object shape uses `type` instead of `interface` for extensibility.

- **INFO** | Line 8: Type name `ClientMessageHandlerContext` duplicates "Context". Consider shorter name.

- **LOW** | Line 10: `send: (message: any)` untyped.

- **LOW** | Line 10: `send` has no return type annotation. Explicit `: void` would clarify usage.

- **LOW** | Line 1: Imports `Session` type from `./SessionManager` — consider a dedicated types file.

- **MEDIUM** | Line 11: `sendError` accepts a raw `string` for `error` instead of an `Error` object, making it easy to leak sensitive details.

- **MEDIUM** | Line 11: `sendError` takes `error: string` — no correlation with actual Error objects.

- **MEDIUM** | Line 9: `session` is optional but there's no guidance on whether handlers must guard against its absence.

- **MEDIUM** | Line 9: `session` is optional — downstream handlers must guard against undefined.


### src/channels/ClientMessageHandlerRegistry.ts

- **HIGH** | Line 36-38: `getAll()` exposes internal Map directly. Callers can mutate registry state.

- **HIGH** | Line 67-72: Decorator executes `container.resolve()` eagerly at class-definition time. Crash during module loading with obscure error.

- **INFO** | Line 25: `register` method has no explicit return type annotation on `handlerFactory` parameter.

- **INFO** | Line 68: Decorator generic constraint uses `any[]` for constructor args — could be tightened to `unknown[]`.

- **LOW** | Line 12: Missing trailing semicolon on `RegistryItem` type. Inconsistent with rest of file.

- **LOW** | Line 16: JSDoc says `@ClientMessageHandler` decorator, export is `ChannelMessageHandler`, example uses `@MessageHandlerFor`. All three names differ, causing confusion.

- **LOW** | Line 19: Class-field initialization for `handlers` map runs even if registry is never used.

- **LOW** | Line 2: Inconsistent import style.

- **LOW** | Line 44: `clear()` has no guard against accidental invocation in production.

- **LOW** | Line 69: Logger omits `schema`, harder to trace which schema registered for debugging.

- **MEDIUM** | Line 25: `register()` accepts raw string for `messageType` with no validation. Typo registers silently.

- **MEDIUM** | Line 36-38: `getAll()` returns the internal `Map` directly, exposing mutable internal state. Return a copy or `readonly Map`.

- **MEDIUM** | Line 36: `getAll()` has no explicit return type annotation. Public API should declare return types.

- **MEDIUM** | Line 67: Decorator factory accepts `ZodTypeAny` with no validation that it's actually a Zod schema — wrong import passes silently until runtime.

- **MEDIUM** | Line 67: JSDoc references `@MessageHandlerFor` but decorator is `ChannelMessageHandler`. Misleading docs.


### src/channels/ClientMessageHandler.ts

- **INFO** | Line 14: Returning `Promise<void> | void` means callers must handle both sync errors and async rejections differently.

- **INFO** | Line 1: Ensure relative import path is correct for `./ClientMessageHandlerContext`.

- **LOW** | Line 8: Type parameter `T` is unconstrained beyond `Record<string, any>`, meaning implementers can't enforce message schema at the handler level.

- **LOW** | Line 8: `Record<string, any>` as default type parameter loses type safety. Use `Record<string, unknown>`.

- **LOW** | Line 8: `Record<string, any>` erases type safety.

- **MEDIUM** | Line 8: `Record<string, any>` default type parameter provides no type safety. Consider using a discriminated union or base message type.


### src/channels/handlers/AbortAiGenerationHandler.ts

- **HIGH** | Line 17: Type unsoundness — `Session` declares `runner: ConversationRunner` (non-nullable) but `registerSession()` assigns `runner: null`.

- **HIGH** | Line 39: `context.session.runner` can be `null` at runtime. Will crash with TypeError if abort message sent before runner is attached.

- **LOW** | Line 44: Success log uses `context.session?.id` even though session was confirmed non-null earlier.

- **LOW** | Line 44: `stageId` not logged in success log. Harder to trace which stage was aborted.

- **LOW** | Line 48: `errorMessage` sent verbatim to client could leak implementation details.

- **LOW** | Lines 17-18: Dead properties. `messageType` and `requiresAuth` set by decorator, never read.

- **MEDIUM** | Line 154: Schema declares `stageId` as required but handler never uses it. Contract/method mismatch.

- **MEDIUM** | Line 154: `stageId` required by schema but never used by handler. Schema should drop it or handler should use it.

- **MEDIUM** | Line 39: Missing `saveCommandEvent` call. Abort operations won't appear in command history.

- **MEDIUM** | Line 41, 48: Response objects are untyped inline literals. Missing explicit response type.

- **MEDIUM** | Lines 41, 48: No typed response. Inline objects lack compile-time type safety.


### src/channels/handlers/AuthHandler.ts

- **HIGH** | Line 102-106: Catch block swallows all errors and returns misleading "Invalid API key". Project-not-found or infra errors should not be reported as auth failure.

- **HIGH** | Line 88: `message.sessionSettings` optional but `setSessionProjectAndSettings` requires it. `undefined` passed, violating type contract.

- **INFO** | Line 92: `message.sessionSettings?.sendVoiceInput !== false` relies on loose falsy check.

- **INFO** | Lines 43-106: `try/catch` swallows all errors. DB failure reported as auth failure. Hard to debug.

- **LOW** | Line 103: Logs raw error object with sensitive details.

- **LOW** | Line 52: `apiKey.keySettings ?? null` is redundant — service already returns `keySettings: apiKey.keySettings ?? null`.

- **LOW** | Line 52: `apiKey.keySettings ?? null` redundant. Already typed as `ApiKeySettings | null`.

- **LOW** | Lines 37, 47, 59, 70, 76, 82, 100, 104: Repeated inline construction of AuthResponse. Helper would reduce duplication.

- **LOW** | Lines 37/47/59/70/76/82/104: Response objects constructed inline with repeated structure. A helper would reduce duplication.

- **LOW** | Lines 56/88/89/100: Repeated `context.session!` non-null assertions. A local const after guard would reduce count.

- **MEDIUM** | Line 103: Logging `{ error }` may expose sensitive internal details (stack traces, DB query strings).

- **MEDIUM** | Line 92: `sendVoiceInput` defaults to `true` when `sessionSettings` omitted. May not match intended behavior.

- **MEDIUM** | Lines 56, 88, 89, 100: `context.session!` non-null assertion on optional property. Type system doesn't guarantee.

- **MEDIUM** | Lines 56/88: Redundant non-null assertions.

- **MEDIUM** | Lines 66-86: Feature permission checks only trigger when flag is `true`. Asymmetric enforcement gap.

- **MEDIUM** | Lines 68-85: Only the first disallowed feature is reported. Client must retry multiple times to discover all violations.

- **MEDIUM** | Lines 68-85: Three nearly identical feature permission check blocks are duplicated. Could be reduced to a loop.


### src/channels/handlers/CallToolHandler.ts

- **HIGH** | Line 38-39: `saveCommandEvent` runs before `callTool`. If save succeeds but callTool fails, event is persisted as issued though tool never executed.

- **HIGH** | Line 38: `message.parameters` logged in full to `saveCommandEvent`. May contain credentials/PII persisted without redaction.

- **HIGH** | Line 39: `runner.callTool()` returns `Promise<any>`. Handler assigns entire result as `result`, bypassing type safety.

- **HIGH** | Line 51-62: Catch block swallows `NotFoundError` and `InvalidOperationError`, converting them to generic `success: false` response.

- **INFO** | Line 23/50: Logger objects repeat same four properties across three log calls. Could extract shared context.

- **INFO** | Lines 26-28: `!context.session` check redundant when `requiresAuth: true`.

- **LOW** | Line 30: `!context.session.conversationId` guard redundant per type system.

- **LOW** | Line 38: Tool parameters persisted without redaction.

- **LOW** | Line 8: Missing semicolon.

- **LOW** | Line 8: Missing trailing semicolon on import. Inconsistent with other handlers.

- **LOW** | Line 9: Dangling comma on last import. Minor style inconsistency.

- **MEDIUM** | Line 38: `saveCommandEvent` is fire-and-forget — if it throws, error is caught and reported as tool failure, masking true error nature.

- **MEDIUM** | Line 52: Only `error.message` logged. Full error and stack trace discarded.

- **MEDIUM** | Line 53: Only `error.message` is logged, dropping stack trace. Harder root-cause analysis.

- **MEDIUM** | Line 54: Error response constructed manually instead of using `context.sendError()`.

- **MEDIUM** | Line 8: Missing semicolon at end of import statement. Inconsistent with other imports.


### src/channels/handlers/EndConversationHandler.ts

- **[DONE] CRITICAL** | Line 46: Non-null assertion `context.session!.id` with no guard — throws TypeError and crashes before catch block.

- **[DONE] CRITICAL** | Line 46: `context.session!.id` — non-null assertion on value that may be null. Crashes before error handler.

- **[DONE] CRITICAL** | Line 57: `context.send(response)` called AFTER `clientConnection.close()`. Response never reaches client.

- **[DONE] CRITICAL** | Line 57: `context.send(response)` called after `context.session?.clientConnection?.close()` — connection already closed, response silently fails.

- **HIGH** | Line 11: No validation that `message.conversationId` matches session's active conversation — client could end arbitrary conversation.

- **HIGH** | Line 27: `context.session` never checked for null.

- **HIGH** | Line 30-33: No guard for `context.session` being null. Proceeds with empty strings.

- **HIGH** | Line 31-33: No guard when `session` is null — `stageId` and `projectId` become empty strings, producing DB records with invalid data.

- **HIGH** | Line 31: No validation that `message.conversationId` matches session's actual conversation.

- **HIGH** | Line 41: `reason: ''` hardcoded. Should use reason from request if available.

- **HIGH** | Line 46-47: `detachConversationFromSession` runs before `finishConversation` — if finish throws, session detached but conversation unfinished with no rollback.

- **LOW** | Line 27: Entry log missing `projectId`. Reduces traceability.

- **LOW** | Line 41: `conversation?.stageVars?.[stageId]` — when stageId is empty string, resolves to undefined with no warning.

- **LOW** | Line 41: `reason` hardcoded to empty string.

- **LOW** | Line 41: `stageVars['']` accessed with empty string. Semantically misleading.

- **LOW** | Line 52: Response sent after connection close.

- **LOW** | Lines 52-56, 62-67: Duplicated response construction. Extract to shared base.

- **MEDIUM** | Line 41: `reason` is hardcoded to empty string — client reason is discarded.

- **MEDIUM** | Line 42: `saveConversationEvent` called with empty strings. May corrupt data.

- **MEDIUM** | Line 43: `context.session?.clientConnection?.sendMessage()` silently does nothing when null.

- **MEDIUM** | Line 43: `context.session?.clientConnection?.sendMessage()` uses optional chaining with no fallback — message silently dropped.

- **MEDIUM** | Line 46: Non-null assertion on unchecked session.

- **MEDIUM** | Line 48-50: Catch block swallows all errors from `close()` with zero logging.

- **MEDIUM** | Line 48-50: Empty catch hides all failures during cleanup. Resource leaks hidden.

- **MEDIUM** | Lines 31-33: Four optional accesses with empty string fallback.


### src/channels/handlers/EndUserVoiceInputHandler.ts

- **HIGH** | Line 42: Error messages leak internal state to client. Runner exposes conversation status and inputTurnId values.

- **INFO** | Line 42: In VAD mode, `stopUserVoiceInput` is silent no-op. No warning log.

- **INFO** | Line 44, 57: Explicit type annotation is redundant — TypeScript infers the type.

- **LOW** | Line 34-36: Check `!context.session.conversationId` is effectively dead code.

- **LOW** | Line 44-50, 57-64: Response uses `message.conversationId` (client-supplied) instead of `context.session.conversationId` (server-authoritative).

- **LOW** | Line 53: Uses `context.session?.id` where session already narrowed. Unnecessary defensive access.

- **LOW** | Line 56: Logs raw `error.message` — may contain PII or sensitive identifiers.

- **MEDIUM** | Line 30: Checks `sessionSettings.sendVoiceInput` but never verifies project-level `acceptVoice`.

- **MEDIUM** | Line 51: `context.send()` can throw (e.g., WebSocket closing). If it throws, error is caught and misleading "Failed to end user voice input" is sent.

- **MEDIUM** | Line 65: If `context.send()` throws inside catch block, error propagates to dispatcher which sends a third error. Client receives conflicting messages.

- **MEDIUM** | Lines 44-51/57-64: Duplicated response construction. Extract to shared base.


### src/channels/handlers/GetAllVarsHandler.ts

- **INFO** | Line 11-12: Class-level JSDoc duplicates method-level JSDoc.

- **LOW** | Line 44: Success log omits `correlationId` while request log includes it.

- **LOW** | Line 47: Log object key `error` shadows the catch-bound `error` variable.

- **LOW** | Line 48: Returns `variables: {}` on error — indistinguishable from "no variables exist."

- **MEDIUM** | Line 16-17: `messageType` and `requiresAuth` use definite assignment assertions but are never assigned by decorator. Dead code.

- **MEDIUM** | Line 26-28: `if (!context.session)` check is likely redundant — decorator sets `requiresAuth: true`.

- **MEDIUM** | Line 42, 49: `context.send()` is unguarded — could throw if connection drops.

- **MEDIUM** | Line 47: Logs `errorMessage` (string) under `error` key instead of original Error object. Pino discards stack.


### src/channels/handlers/GetVarHandler.ts

- **HIGH** | Line 38-39: If `saveCommandEvent` succeeds but `getVariable` fails, command event is persisted though operation didn't complete.

- **HIGH** | Line 41: Response `type` is `'get_var'`, inconsistent with siblings using `*_result` for responses.

- **INFO** | Line 38: `saveCommandEvent` before `getVariable`. If throws, command persisted as issued but failed.

- **LOW** | Line 26: Redundant `!context.session` check. Decorator guarantees non-null.

- **LOW** | Line 41: Single-line object construction spans ~180 chars. Reduces readability.

- **LOW** | Line 47: Error log is missing `correlationId`.

- **LOW** | Line 47: Only `error.message` is logged; stack traces discarded.

- **LOW** | Lines 10-11, 19-20: Class-level and method-level JSDoc are identical.

- **MEDIUM** | Line 23: Logging `variableName` can leak sensitive information if variable name is revealing.

- **MEDIUM** | Line 39: `runner.getVariable()` returns `Promise<any>`. Any value could serialize to malformed JSON.

- **MEDIUM** | Line 41: `variableValue` can be `undefined`. Client can't distinguish "null value" from "not found".

- **MEDIUM** | Line 44: Success log is missing `correlationId`, breaking end-to-end tracing.

- **MEDIUM** | Line 48: Error response omits `variableValue` property, producing different response shape than success path.

- **MEDIUM** | Line 49: `context.send()` can throw on closed WebSocket. Exception propagates unhandled.


### src/channels/handlers/GoToStageHandler.ts

- **HIGH** | Line 38-39: `saveCommandEvent` persists before `goToStage` executes. If goToStage throws, audit log records command that never completed.

- **HIGH** | Line 39: No validation that `stageId` is non-empty. Empty string passes through.

- **INFO** | Line 39: No pre-validation that target stage exists. Relies on runner to discover.

- **INFO** | Line 42: `context.send(response)` has no error handling — response silently dropped if connection closed.

- **LOW** | Line 16-17: `messageType` and `requiresAuth` properties declared but never read. Dead code.

- **LOW** | Line 20: Duplicate JSDoc. Repeats class-level comment.

- **LOW** | Line 44, 47: Uses `context.session?.id` after session was already guarded. Redundant.

- **LOW** | Line 44: Redundant optional chaining `context.session?.id`. Already guaranteed non-null.

- **LOW** | Line 49: `context.send()` unprotected. If connection broken, error propagates unhandled.

- **MEDIUM** | Line 26-28: Redundant `if (!context.session)` check. Decorator guarantees session.

- **MEDIUM** | Line 30: Ambiguous falsy check on `conversationId`. Type is non-optional string.

- **MEDIUM** | Line 30: `!context.session.conversationId` falsy check implies conversationId can be null, but Session type declares it as non-nullable string.

- **MEDIUM** | Line 47: Error log records only `error.message`, discarding stack trace.

- **MEDIUM** | Line 47: Error response omits `stageId`. Harder to correlate which stage failed.


### src/channels/handlers/ResumeConversationHandler.ts

- **HIGH** | Line 48-50: Error message says "archived project" but checks `conversation.archived`. Should say "archived conversation".

- **HIGH** | Line 52: If `attachConversationToSession` throws, no response sent. Session left in inconsistent state.

- **HIGH** | Line 55-56: Success response sent BEFORE `resumeConversation()` called. Client told success before operation.

- **HIGH** | Line 60: No null guard on `context.session.runner` before calling `resumeConversation()`. Crashes if runner not initialized.

- **INFO** | Line 19-20: `messageType` and `requiresAuth` declared with definite assignment assertions.

- **INFO** | Line 54: Comment "Return success response" redundant with code.

- **INFO** | Lines 13-14/24-25: Duplicate JSDoc text.

- **LOW** | Line 22: Constructor parameters with decorators on single line exceed reasonable line length.

- **LOW** | Line 44-46: Returns "Conversation not found" for cross-project access denial. Could use `ForbiddenError` for clearer debugging.

- **LOW** | Line 48: `conversation.archived` from project status. Field name misleading.

- **LOW** | Line 63: `context.session?.id` uses optional chaining. Inconsistent with non-null assertions at lines 66-68.

- **LOW** | Line 69-71: Cleanup errors logged but no corrective action. Conversation state may be inconsistent.

- **LOW** | Lines 55-56: Response before `resumeConversation()` completes.

- **MEDIUM** | Line 52: `attachConversationToSession` is unguarded — session left in partial state if it throws.

- **MEDIUM** | Line 55-56: Success response sent before attempting `resumeConversation()`. If resume fails, client has already received `success: true`.

- **MEDIUM** | Line 66-68: `failConversation` and `saveConversationEvent` both call `requireProjectNotArchived()`. Redundant.

- **MEDIUM** | Line 67: `saveConversationEvent` updates `lastActivityAt` even for terminal failed state. Interferes with timeout.

- **MEDIUM** | Line 68: Uses `context.session!.clientConnection?.sendMessage()` with mixed null handling — could silently drop event.

- **MEDIUM** | Line 68: `conversation_event` sent without `correlationId`. Client can't correlate.

- **MEDIUM** | Line 69-71: Cleanup errors from `failConversation` and `saveConversationEvent` silently swallowed.

- **MEDIUM** | Lines 66-69: Non-null assertions in cleanup.


### src/channels/handlers/RunActionHandler.ts

- **HIGH** | Line 46: `executePendingTerminalAction()` can throw after success response sent. Client gets conflicting responses.

- **HIGH** | Line 46: `executePendingTerminalAction()` outside try-catch — if it throws, error is unhandled and client in inconsistent state.

- **HIGH** | Line 52: `context.send()` throws in catch block. Exception propagates unhandled.

- **INFO** | Line 13: Decorator positional arguments not self-documenting. Consider config object.

- **INFO** | Lines 10-12: Class JSDoc repeats method JSDoc. Redundant.

- **LOW** | Line 13: Category `'run_action'` duplicates type string. Inconsistent with other handlers.

- **LOW** | Line 48: Success log references `message.actionName` but action may have completed with different effective name.

- **LOW** | Line 50: Swallows error stack traces by extracting only `error.message`.

- **LOW** | Line 51: Error log only captures `error.message`. Discards stack trace.

- **MEDIUM** | Line 23: `actionName` logged without sanitization. Log injection possible.

- **MEDIUM** | Line 27: Uses `NotFoundError` for missing session, but should be `InvalidOperationError` for consistency.

- **MEDIUM** | Line 36: `parameters` schema lacks `.optional()` or `.default({})`. Missing key fails validation.

- **MEDIUM** | Line 38: `saveCommandEvent` called before `runAction`. If runAction throws, command persisted with no failure record.

- **MEDIUM** | Line 43: Response includes `error: undefined` when `success: true`. Serializes with extra property.

- **MEDIUM** | Line 48: Success log fires before `executePendingTerminalAction()` completes. Can log success for failed action.

- **MEDIUM** | Line 52: Response includes `result: undefined` when `success: false`. Extra property in error response.


### src/channels/handlers/SendUserTextInputHandler.ts

- **[DONE] CRITICAL** | Line 43: `context.session.runner` accessed without null guard. `runner` may be undefined if session not attached to conversation.

- **[DONE] CRITICAL** | Line 43: `context.session.runner` can be `null`. No guard before calling `runner.receiveUserTextInput()`. Runtime crash.

- **HIGH** | Line 63: Raw internal `error.message` sent directly to client. Can leak implementation details.

- **INFO** | Line 19-20: Method-level JSDoc duplicates class-level doc.

- **INFO** | Lines 10-12/19-21: Duplicate JSDoc text.

- **LOW** | Line 25: `inputTurnId` initialized to `''` — error response sends empty string. Consider undefined or omit.

- **LOW** | Line 27: Redundant `!context.session` check. Decorator guarantees session exists.

- **LOW** | Line 35-41: Redundant checks — could be consolidated into single comparison.

- **LOW** | Line 35: Redundant `!context.session.conversationId` check. Type is non-optional string.

- **LOW** | Line 54: Uses `context.session?.id` where session already narrowed. Inconsistent with non-null assertions.

- **MEDIUM** | Line 54: Success log fires after `context.send(response)`. If send fails, log still records success.

- **MEDIUM** | Line 57: Logs `error` as plain string, losing stack trace. Should log full Error object.


### src/channels/handlers/SendUserVoiceChunkHandler.ts

- **INFO** | Line 43: `message.inputTurnId ?? ''` passes empty string. Confusing error message.

- **INFO** | Lines 10-12/19-21: Duplicate JSDoc text.

- **INFO** | Lines 45-51 & 56-63: Response object construction duplicated between success and error paths.

- **LOW** | Line 42: `Buffer.from(message.audioData, 'base64')` silently ignores invalid base64. Corrupted data flows downstream.

- **LOW** | Line 55: Error log captures `error.message` but discards stack trace.

- **LOW** | Lines 10-12 & 19-21: Duplicate JSDoc — class-level and method-level comments are identical.

- **LOW** | Lines 16-17: `messageType` and `requiresAuth` declared with `!` assertions but never read inside class body.

- **LOW** | Lines 22-66: Missing success completion log. Harder to trace in production.

- **LOW** | Lines 45-52/56-64: Response construction duplicated. Extract to single point.

- **MEDIUM** | Line 23: Uses `logger.debug` for voice chunk requests — invisible in production logs with default LOG_LEVEL=info.

- **MEDIUM** | Line 30: `ordinal` field defined in schema but handler never reads or uses it. Out-of-order chunks not detected.

- **MEDIUM** | Line 42: No size validation before base64 decode.

- **MEDIUM** | Line 42: `ordinal` field validated by schema but never used. Chunks can't be reordered.

- **MEDIUM** | Line 43: `message.inputTurnId ?? ''` passes empty string when undefined. In non-VAD mode, will mismatch against real turn ID and throw.

- **MEDIUM** | Lines 23, 55: Logs use `message.sessionId` from untrusted client. Enables log injection.

- **MEDIUM** | Lines 23/55: Logs `message.sessionId` (user-controlled) instead of `context.session?.id`.

- **MEDIUM** | Lines 53-64: If `context.send(response)` throws inside catch block, exception propagates uncaught and can crash WebSocket.


### src/channels/handlers/SetVarHandler.ts

- **HIGH** | Line 38-39: `saveCommandEvent` persists before `setVariable` executes. If setVariable fails, orphan command event recorded.

- **HIGH** | Line 38: `variableValue` persisted to audit log without sanitization. Secrets/PII recorded permanently.

- **INFO** | Line 11, 20: Duplicate JSDoc — class-level and method-level comments are identical.

- **INFO** | Line 23: `correlationId` can be undefined. Logs produce `"correlationId": undefined`.

- **LOW** | Line 16-17: Redundant property declarations — `messageType` and `requiresAuth` with `!` assertions.

- **LOW** | Line 22-51: Repeated session validation boilerplate duplicated across every handler. Should be extracted.

- **LOW** | Line 26: Redundant guard. Decorator guarantees session exists.

- **LOW** | Line 34: Error message doesn't include expected vs actual values. Harder to diagnose.

- **LOW** | Line 38: `variableValue` persisted in plaintext. No redaction.

- **MEDIUM** | Line 38: Sensitive data in audit log — `variableValue` stored verbatim in command event parameters. Secrets/PII persist in plaintext.

- **MEDIUM** | Line 41: Missing `stageId` in success response — client can't correlate which stage variable was set on.

- **MEDIUM** | Line 47: Only `error.message` logged. Full error and stack trace discarded.

- **MEDIUM** | Lines 38-39: `saveCommandEvent` before `setVariable`. If throws, audit log records success that didn't happen.


### src/channels/handlers/StartConversationHandler.ts

- **HIGH** | Line 137-139: Uses `context.session!` inside outer catch block. If session destroyed during error, will crash.

- **HIGH** | Line 62, 143: `detachConversationFromSession()` not awaited. May not complete before handler returns.

- **HIGH** | Lines 128-129/130: `context.send()` inside try block. If send fails, catch marks conversation as failed.

- **HIGH** | Lines 56-57/58: Same issue in outgoing call path. Send failure detaches conversation.

- **INFO** | Line 117: `createConversation` call spans one very long line. Extract config for readability.

- **INFO** | Lines 16-17/32-33: Duplicate JSDoc comment.

- **INFO** | Lines 93/137-139: Non-null assertions redundant after guard.

- **LOW** | Line 117: `projectId: stage.projectId` redundant — already verified equal to `context.session.projectId`.

- **LOW** | Line 64: `conversationId ?? ''` is dead code — conversationId set synchronously before any await.

- **LOW** | Line 75: `let user;` has no type annotation. Relies on inference.

- **LOW** | Line 86: Comment says "Get stage to extract projectId" but code checks `user.banned`. Misleading.

- **LOW** | Line 92-93: Comment says "Deep-merge" but code passes `message.userProfile` directly. Comment misleading.

- **LOW** | Lines 49-67 vs 70-148: Duplicated response/error handling.

- **LOW** | Lines 60/132: Logger receives string instead of Error object. Discards stack trace.

- **LOW** | Lines 64/146: Empty string fallback for UUID.

- **LOW** | Lines 64/146: `conversationId: conversationId ?? ''` — empty string ambiguous.

- **MEDIUM** | Line 111: `user.profile.timezone as string | undefined` — bare type assertion bypasses type safety.

- **MEDIUM** | Line 111: `user.profile.timezone as string | undefined` — unsafe type assertion.

- **MEDIUM** | Line 139: Sends `conversation_event` during error cleanup, then error response. Client receives two messages in undefined order.

- **MEDIUM** | Line 143: `detachConversationFromSession()` outside inner try-catch. If throws, response never sent.

- **MEDIUM** | Line 86: Comment reads "Get stage to extract projectId" but code checks `user.banned`. Comment misplaced.

- **MEDIUM** | Line 93: `context.session!.projectId` — unnecessary non-null assertion after guard.

- **MEDIUM** | Lines 92-94: `userProfile` deep-merged before validating `stageId`. Partial side effect before validation.

- **MEDIUM** | Lines 93/137-139: Non-null assertions on `session`.


### src/channels/handlers/StartUserVoiceInputHandler.ts

- **HIGH** | Line 30: `context.session.sessionSettings` accessed without null check — throws unhandled TypeError.

- **HIGH** | Line 42: `context.session.runner` accessed without null check — same crash risk.

- **HIGH** | Line 51-64: If `context.send()` throws, catch sends second error response. Double response risk.

- **HIGH** | Line 54-64: Catch block swallows ALL errors, including unexpected runtime errors. Internal failures silently returned as `success: false`.

- **INFO** | Line 23: `context.session?.id` redundant — null guard at line 26 throws if missing.

- **INFO** | Line 53: `context.session?.id` redundant — session guaranteed at this point.

- **LOW** | Line 16-17: `messageType` and `requiresAuth` use definite assignment assertions but rely on decorator.

- **LOW** | Line 23/53: `context.session?.id` uses optional chaining after guard was already checked.

- **LOW** | Line 44-50/57-63: Duplicate response construction. Extract base response.

- **LOW** | Line 56: Logger property `error` holds string. Pino may treat specially.

- **MEDIUM** | Line 42: `runner.startUserVoiceInput()` errors indistinguishable from validation errors in catch block.

- **MEDIUM** | Line 42: `startUserVoiceInput()` returns empty string in VAD mode. Breaks subsequent operations.

- **MEDIUM** | Line 53: Success logger inside try block after send. If throws, catch sends second response.

- **MEDIUM** | Line 55: Error handling discards original error object. Stack trace and type lost.

- **MEDIUM** | Line 56: `error` logged as plain string rather than full error object. Loses stack trace.


### src/channels/SessionManager.ts

- **HIGH** | Line 65: Session ID uses `Math.random()` — not cryptographically secure, ~7.8 trillion values. Use `crypto.randomUUID()`.

- **HIGH** | Line 65: `Math.random()` for session ID not cryptographically secure. Use `crypto.randomUUID()`.

- **HIGH** | Line 65: `substr` is deprecated. Use `substring`.

- **HIGH** | Line 68: `projectId: null` assigned but type is `string`. Runtime values violate declared Session type.

- **HIGH** | Lines 117-128: `attachConversationToSession` doesn't clean up existing runner. Old runner abandoned.

- **HIGH** | Lines 124-125: Dynamic import + `container.resolve(ConversationRunner)` — if singleton, all sessions share runner. Cross-session corruption.

- **HIGH** | Lines 135-143, 151-158: `detachConversationFromSession` clears runner without calling `runner.cleanup()`. Resource leak.

- **HIGH** | Lines 68-69, 141-142, 154-155: `projectId`/`conversationId` typed as `string` but assigned `null`. Type violation.

- **INFO** | Lines 52-53: No session count tracking or eviction policy. Maps grow unbounded under load.

- **LOW** | Line 108: `this.idMap.get(sessionId) || null` — `Map.get()` returns `undefined` on miss. No-op coercion.

- **LOW** | Line 108: `|| null` no-op for `undefined`.

- **LOW** | Line 165: `unregisterSession` silently returns when session not found, unlike other methods that throw. Inconsistent.

- **LOW** | Lines 117, 135: Missing explicit return type annotations.

- **LOW** | Lines 151-158: `detachConversationFromSessions` also O(N) with same optimization opportunity.

- **LOW** | Lines 184-192: `getSessionsForConversation` is O(N). Consider reverse map for O(1) lookup.

- **LOW** | Lines 68-70: Assigns `null` to non-nullable fields.

- **LOW** | Lines 72: Default `sessionSettings` constructed inline. Duplicates configuration.

- **LOW** | Lines 99/127/143/156: Redundant re-insert.

- **MEDIUM** | Line 108: `this.idMap.get(sessionId) || null` — `||` swallows falsy. Use `??`.

- **MEDIUM** | Line 117: `attachConversationToSession` has no explicit return type annotation.

- **MEDIUM** | Line 123: If `prepareConversation` throws, `session.conversationId` set but `session.runner` may be broken. No rollback.

- **MEDIUM** | Line 124: Dynamic `import()` unnecessary — module already imported as type. `.js` extension inconsistent.

- **MEDIUM** | Line 135: `detachConversationFromSession` never calls `session.runner.cleanup()`. Can leak runner resources.

- **MEDIUM** | Line 60: `registerSession` doesn't check if `clientConnection` already has a session. Duplicate registrations allowed.

- **MEDIUM** | Line 65: `Math.random().toString(36).substr(2, 9)` — `substr()` is deprecated. Use `slice()`.

- **MEDIUM** | Line 65: `Math.random().toString(36).substr(2, 9)` — deprecated `substr`, non-crypto IDs.

- **MEDIUM** | Lines 152-158: `detachConversationFromSessions` is O(N). Iterates `entries()` instead of `values()`.

- **MEDIUM** | Lines 165-178: `unregisterSession` silently returns void when session not found. No logging.

- **MEDIUM** | Lines 184-192: `getSessionsForConversation` is O(N). Consider reverse index.

- **MEDIUM** | Lines 52-53: No TTL, max-size bound, or periodic cleanup. Memory leak under connection churn.

- **MEDIUM** | Lines 60-81: `registerSession` doesn't check if connection already has session. Silent overwrite.

- **MEDIUM** | Lines 99, 127, 143, 156: Redundant `this.idMap.set()` calls. Map already holds same reference.

- **MEDIUM** | Lines 99, 127, 143, 156: Redundant `this.idMap.set(...)`. Session mutated in place; re-set is no-op.


### src/channels/IChannelDescriptor.ts

- **INFO** | Line 5: `ChannelCapabilities` has no runtime validation (Zod schema). Can't validate if serialized externally.

- **LOW** | Line 0: File named `IChannelDescriptor.ts` but exports `ICommunicationChannel` and `ChannelCapabilities`. Misleading name.

- **LOW** | Line 1: Inconsistent import style.

- **LOW** | Line 1: `import z from "zod"` uses default import. Idiomatic Zod v3 is `import { z } from "zod"`.

- **LOW** | Line 63: `z.ZodObject<any>`.

- **MEDIUM** | Line 1: File name doesn't match contents. Exports `ICommunicationChannel` and `ChannelCapabilities`, not a "descriptor".

- **MEDIUM** | Line 1: `import z from "zod"` — Non-standard default import. Convention is `import { z } from "zod"`.

- **MEDIUM** | Line 63: `getConfigSchema(): z.ZodObject<any>` — use of `any` discards type safety.

- **MEDIUM** | Line 63: `z.ZodObject<any>` — Using `any` defeats type safety. Should use `z.ZodObject<z.ZodRawShape>`.


### src/channels/IClientConnection.ts

- **INFO** | Line 20: Parameter named `response` is misleading — sends messages in both directions, not only responses.

- **INFO** | Line 4: "Abstract interface" is redundant — all TypeScript interfaces are abstract by definition.

- **INFO** | Lines 4-10: Docblock verbose for simple 3-member interface.

- **LOW** | Line 20: `Promise<void>` gives no success confirmation or message ID.

- **LOW** | Line 20: `sendMessage` parameter named `response` but semantically it's a message, not an HTTP response.

- **LOW** | Line 20: `sendMessage` returning `Promise<void>` provides no success confirmation or message ID.

- **LOW** | Line 25: No `isOpen` / `isConnected` / `readyState` property — callers must blindly call `sendMessage`.

- **MEDIUM** | Line 20: Missing `isConnected` or `isOpen` state property. Callers can't check connection validity before send.

- **MEDIUM** | Line 25: `close()` takes no parameters. Unable to pass close reason or error code.


### src/channels/messages.ts

- **[DONE] CRITICAL** | Line 251: `calSetVarResponseSchema` uses `type: z.literal('set_var_result')` instead of `'set_var'`. Breaks type-based message routing.

- **HIGH** | Line 251: `calSetVarResponseSchema` uses `type: 'set_var_result'` while request uses `type: 'set_var'`. Inconsistency can break client-side message correlation.

- **HIGH** | Lines 317, 389, 400: `z.instanceof(Buffer)` makes schema incompatible with JSON serialization.

- **INFO** | Lines 470-512: 43 manual `z.infer` type exports duplicate TypeScript derivation. Increases maintenance burden.

- **INFO** | Lines 470-512: ~43 mechanically inferred type exports. Consider codegen script.

- **INFO** | Lines 9-12: Header comment describes `CAL<Action>ResultMessage` but actual exports use `CAL<Action>Response`. Mismatch.

- **LOW** | Line 251: Inconsistent discriminator naming.

- **LOW** | Lines 136, 145: `z.record(z.string(), parameterValueSchema)` allows arbitrary string keys. No format validation.

- **LOW** | Lines 283-284: `result` in `calRunActionResponseSchema` is optional. Consumers must distinguish `undefined` vs `[]`.

- **LOW** | Lines 53-54: `userProfile` and `stageVariables` accept `z.record(z.string(), z.unknown())` with no depth/size limits. DoS risk.

- **LOW** | Lines 53-54: `userProfile` and `stageVariables` use `z.record(z.string(), z.unknown())`. Accepts arbitrary values.

- **MEDIUM** | Line 317: `calSendAiVoiceChunkMessageSchema` has `audioFormat` but no `mimeType`. Inconsistent with other schemas.

- **MEDIUM** | Line 317: `z.instanceof(Buffer)` will fail validation in non-Node.js environments.

- **MEDIUM** | Line 389: `z.instanceof(Buffer)` — same issue as line 317.

- **MEDIUM** | Line 400: `z.instanceof(Buffer)` — same issue as line 317.

- **MEDIUM** | Lines 181-295: All response schemas repeat `success` + `error` pattern. Could extract shared base.

- **MEDIUM** | Lines 250-254: `calSetVarResponseSchema` naming deviates from convention. Export is `CALSetVarResponse`, not `CALSetVarResultMessage`.

- **MEDIUM** | Lines 442-466: Discriminated union includes `z.instanceof(Buffer)` fields. Non-Node context throws rather than clean discrimination failure.


### src/channels/telegram/TelegramChannelHost.ts

- **HIGH** | Line 419-421: When `start_conversation` fails, session registered but never cleaned up. Orphaned session.

- **HIGH** | Line 517-522: `setTimeout` callback is `async` — errors inside `unregisterSession` become unhandled promise rejections.

- **HIGH** | Line 99: `parseInt` can produce `NaN` if env var non-numeric. `setTimeout(cb, NaN)` fires immediately, destroying all sessions.

- **INFO** | Line 524: `handle.unref?.()` — optional chaining unnecessary noise.

- **LOW** | Line 259: Message silently dropped.

- **LOW** | Line 350: `configResult.error.issues` logged at error level could leak sensitive config details.

- **LOW** | Line 412: Type guard duck-typing check on any unknown object — fragile.

- **LOW** | Line 469: `text.split(/\s+/)[1]` only captures first token — stage IDs with spaces truncated.

- **LOW** | Line 99: No `NaN` guard on `parseInt`.

- **MEDIUM** | Line 185-189: `fetch` to Telegram Bot API has no timeout — hanging response blocks indefinitely.

- **MEDIUM** | Line 231: `apiKey` and `channelProviderId` interpolated into URL without `encodeURIComponent`.

- **MEDIUM** | Line 231: `stageId` available but never included in constructed `webhookUrl`.

- **MEDIUM** | Line 340-345: `extractWebhookData` doesn't verify `providerRecord.apiType === 'telegram'`.

- **MEDIUM** | Line 99: Negative or zero `TELEGRAM_SESSION_TIMEOUT_MS` accepted without clamping.


### src/channels/telegram/TelegramCommunicationChannel.ts

- **MEDIUM** | Line 27: `z.ZodObject<any>` uses `any` as generic argument, defeating type safety.


### src/channels/telegram/TelegramConnection.ts

- **MEDIUM** | Line 67: Markdown parsing fails on unescaped characters.


### src/channels/twilio-messaging/TwilioMessagingChannelHost.ts

- **[DONE] CRITICAL** | Lines 163, 281: No project ownership check on `channelProviderId`. Cross-project data exfiltration possible. (False positive — providers are global, not scoped to projects.)

- **HIGH** | Line 65: `parseInt` on `TWILIO_MESSAGING_SESSION_TIMEOUT_MS` can produce `NaN`. All sessions time out instantly.

- **HIGH** | Lines 231-235: Race condition — `dispatch(startMsg)` async but `dispatchTextInput` runs immediately after. First message silently dropped.

- **HIGH** | Lines 254-348: `handleOutgoingMessage` has no rate limiting. Unlimited outgoing messages possible.

- **INFO** | Lines 203-214: Double-check pattern — redundant second check. Could use simpler `else` branch.

- **LOW** | Line 222: Variable shadowing.

- **LOW** | Line 375: `buildContext.send` silent no-op with no logging.

- **LOW** | Line 434: `providers.providerType` comment lists wrong types. Not documented.

- **LOW** | Line 65: No `NaN` guard on `parseInt`.

- **MEDIUM** | Lines 127, 254: `req.ip` for rate limiting unreliable behind proxies. `handleOutgoingMessage` has no rate limiting.

- **MEDIUM** | Lines 170-177, 287-293: Duplicate provider loading + config parsing logic. Should extract to shared method.

- **MEDIUM** | Lines 24-26: Fragile twilio module resolution via `as any` + `.default` interop. Can break with bundlers.

- **MEDIUM** | Lines 26, 65: Constructor parameters `fromNumber` and `toNumber` semantically reversed.

- **MEDIUM** | Lines 65, 182: `authToken` accessible in scope during `validateRequest` call. Could leak if it throws/logs.


### src/channels/twilio-messaging/TwilioMessagingCommunicationChannel.ts

- **HIGH** | Line 26: `getConfigSchema()` returns empty schema instead of provider config schema. Required fields never validated.

- **LOW** | Line 26: Empty config schema.

- **LOW** | Line 2: Import of `z` from `'zod'` only used for return type and inline empty schema.


### src/channels/twilio-messaging/TwilioMessagingConnection.ts

- **HIGH** | Line 48: `this.session.id` accessed without guard — throws TypeError if `attachSession()` never called.

- **HIGH** | Line 65: Creates new `TwilioClient` on every `sendMessage` call. Should be reused.

- **INFO** | Line 31: `authToken` stored as long-lived class property. Credential in memory for connection lifetime.

- **LOW** | Line 61: `msg.fullText?.trim()` — `?.` unnecessary. `fullText` is non-optional.

- **LOW** | Line 65: New Twilio client per message.

- **MEDIUM** | Line 23: `session` property never initialized — implicitly undefined. Should be explicit `null`.

- **MEDIUM** | Line 5-7: Twilio import uses `as any` cast. Fragile against module format changes.

- **MEDIUM** | Line 68-70: Error caught, logged, and silently swallowed. Caller has no way to know message failed.


### src/channels/twilio-voice/TwilioVoiceChannelHost.ts

- **CRITICAL** | Line 259-262: Twilio request signature validation failure silently ignored — any unsigned request proceeds.

- **HIGH** | Line 257: `req.body` cast to `Record<string, string>` but Twilio sends form-encoded. `req.body` may be unparsed, causing silent validation bypass.

- **HIGH** | Line 301: `track: 'inbound_track'` not valid Twilio track value. Defaults to bidirectional, sending outbound audio unnecessarily.

- **HIGH** | Line 302-307: Raw API key transmitted as TwiML `<Parameter>` — exposed to Twilio infrastructure and logs.

- **HIGH** | Lines 258-263: Request signature validation disabled. Webhook unauthenticated.

- **INFO** | Line 462: DTMF digits logged but never forwarded to conversation runner.

- **LOW** | Line 324, 366, etc: `ws.close()` called without status code or reason.

- **LOW** | Line 342: Unhandled rejection in `ws.on('close')`.

- **LOW** | Line 432: When `session?.runner` null, inbound audio chunks silently dropped with no logging.

- **LOW** | Line 559: Deprecated `substr`, non-crypto ID.

- **LOW** | Line 559: `Math.random().toString(36).substr(2, 9)` — `substr` deprecated.

- **LOW** | Line 632: `send` callback parameter typed as `(msg: any)`.

- **LOW** | Line 652: `session?.id` uses unnecessary optional chaining after guard.

- **MEDIUM** | Line 121: `pendingOutboundCalls` Map has no TTL or eviction — memory leak over time.

- **MEDIUM** | Line 187: No `ws.on('error')` handler — unhandled errors won't trigger cleanup, leaving sessions dangling.

- **MEDIUM** | Line 559: `sessionId` generated with `Math.random()` but never used. Dead code.

- **MEDIUM** | Lines 224-252, 371-398, 505-536: API key validation, provider loading, config parsing duplicated three times.


### src/channels/twilio-voice/TwilioVoiceCommunicationChannel.ts

- **INFO** | Line 34: Return type unnecessarily restrictive to `ZodObject` specifically.

- **LOW** | Line 35: Empty config schema.

- **LOW** | Line 35: `z.object({})` empty schema with no documentation.

- **MEDIUM** | Line 34: Return type `z.ZodObject<any>` uses unsafe `any`.


### src/channels/twilio-voice/TwilioVoiceConnection.ts

- **HIGH** | Line 151/157/167/176: `this.ws.send()` calls without checking `ws.readyState`. Throws if WebSocket closed.

- **HIGH** | Line 30: `session` typed as non-optional but never initialized. Every `this.session?.id` is workaround for incorrect type.

- **HIGH** | Line 99: Twilio module resolution via `as any` fallbacks fragile and untyped.

- **INFO** | Line 173: `markCounter` increments monotonously, never reset. Unbounded over process lifetime.

- **INFO** | Line 84-94: `done` flag + `resolveOnce` pattern could use simpler `Promise.race` with `AbortSignal.timeout()`.

- **LOW** | Line 108-110: Dynamic import of `ws` module just to read `WS.OPEN` constant (which is 1).

- **LOW** | Line 180-181: `default` case silently drops unrecognized message types with no logging.

- **LOW** | Line 93: `setTimeout(resolveOnce, 5000)` magic number. Should be named constant.

- **LOW** | Lines 98/109: Dynamic import on every call.

- **MEDIUM** | Line 104: `error` passed as `unknown` to logger. Non-serializable errors can crash pino.

- **MEDIUM** | Line 113: Empty `catch` block swallows all errors from `ws.close()` without logging.

- **MEDIUM** | Line 165: `msg.audioData.toString('base64')` assumes Buffer. Wrong output for Uint8Array.

- **MEDIUM** | Line 33: `isClosing` public and mutable. Should be private.


### src/channels/webrtc/WebRTCChannelHost.ts

- **HIGH** | Line 214-218: `cleanupPeerConnection` never calls `unregisterSession()`. Session remains registered indefinitely (resource leak).

- **HIGH** | Line 245-246: `getSession(sessionId)` result passed to `attachSession()` without null check. Crashes if null.

- **HIGH** | Line 254-265: `audioSink.ondata` captures `session` by reference. After unregister, closure accesses stale session.

- **HIGH** | Line 268-270: `handleControlMessage` called without `await`/`.catch()`. Unhandled rejection can crash process.

- **HIGH** | Line 356-363: `cleanupPeerConnection` never calls `sessionManager.unregisterSession()`. Session leaks.

- **INFO** | Line 192-197: Only captures first audio track. Multiple tracks silently ignored.

- **INFO** | Line 201-211: Only handles `control` label. Non-control data channels silently ignored.

- **LOW** | Line 154: `app: any`.

- **LOW** | Line 154: `registerRoutes(app: any)` uses `any`, losing type safety.

- **LOW** | Line 154: `registerRoutes(app: any)` — uses `any` instead of proper Express type.

- **LOW** | Line 209: Errors in `.then()` swallowed.

- **LOW** | Line 233: `pc.localDescription!.sdp` non-null assertion. Throws if `setLocalDescription` fails silently.

- **LOW** | Line 308: `send: (msg: any)` uses `any`, bypassing type checking.

- **LOW** | Line 308: `send: (msg: any)` — send callback accepts `any`.

- **LOW** | Line 342: `handleDisconnect` async but called from `onclose` without await or catch.

- **LOW** | Line 356-363: `cleanupPeerConnection` O(n) map iteration. Consider reverse map for O(1).

- **LOW** | Line 52: No `NaN` guard on `parseInt`.

- **MEDIUM** | Line 214-219 + 342-351: Double-cleanup race between `onconnectionstatechange` and `onclose`.

- **MEDIUM** | Line 242: `inboundAudioTrack` passed by value. Race between `ondatachannel` and `ontrack` → sink created with `null`.

- **MEDIUM** | Line 254-265: `audioSink.ondata` callback captures stale session from closure. May call detached runner.

- **MEDIUM** | Line 262: Empty string passed as turn ID in VAD mode. Downstream may not handle correctly.

- **MEDIUM** | Line 268-270: Same closure staleness for `controlChannel.onmessage`.

- **MEDIUM** | Line 272-274: `handleDisconnect` not awaited. Cleanup fire-and-forget; resources leak on failure.

- **MEDIUM** | Line 295: `connection.close()` throws, unhandled rejection propagates to event loop.

- **MEDIUM** | Line 356-363: `cleanupPeerConnection` iterates full map O(n). Should use reverse Map for O(1).

- **MEDIUM** | Line 52: `parseInt()` on non-numeric env yields `NaN`. `setTimeout(fn, NaN)` fires immediately.

- **MEDIUM** | Line 52: `parseInt` on env var can produce `NaN`. `setTimeout(cb, NaN)` fires immediately.


### src/channels/webrtc/WebRTCCommunicationChannel.ts

- **INFO** | Line 1: Unused import `z` from `'zod'` — only used in return type annotation.

- **LOW** | Line 46: Empty config schema.

- **LOW** | Line 46: Return type `z.ZodObject<any>` uses `any`, losing type safety.

- **LOW** | Line 46: Return type `z.ZodObject<any>` uses `any`. Should use proper generic constraint.

- **MEDIUM** | Line 14-21: `WEBRTC_SUPPORTED_AUDIO_FORMATS` hardcoded instead of derived from `audioFormatValues`. Duplicates source of truth.

- **MEDIUM** | Line 61: Returns `WEBRTC_SUPPORTED_AUDIO_FORMATS` directly without copying. Consumers can mutate module-level constant.


### src/channels/webrtc/WebRTCConnection.ts

- **HIGH** | Line 122: `sendMessage` is `async` but contains no `await` — misleading or indicates missing error handling.

- **HIGH** | Line 123: `this.session` destructured without null check — crashes if called before `attachSession()`.

- **HIGH** | Line 294: Same uninitialized `this.session` access in `pushAudioToTrack()`.

- **HIGH** | Line 340-352: `ensureAudioScheduler` has no "closed" guard. New interval started on dead connection, leaking timer.

- **HIGH** | Line 343-351: Scheduler `setInterval` callback can fire after `close()`. No guard against destroyed audio source.

- **INFO** | Line 103: `sendRawControl` is thin wrapper that just calls `sendControl`. Indirection adds no value.

- **INFO** | Line 279: `sendControl` parameter `message` typed as `Record<string, unknown>`. Consider named type.

- **INFO** | Line 36: `this.session` mutable and uninitialized. Line 123 destructures without guard — would crash.

- **LOW** | Line 123: Unguarded `this.session` access.

- **LOW** | Line 271-273: Redundant cast — `msg.type` accessible directly.

- **LOW** | Line 312: Shared `ArrayBuffer` risk.

- **LOW** | Line 327: `flushAudioRemainder` silently drops remainder if scheduler never started.

- **LOW** | Line 343: `setInterval` at 10ms not real-time precise. Drift under CPU load/GC.

- **LOW** | Line 47-51: `audioSource` is nonstandard. If track stopped, `onData()` fails silently.

- **LOW** | Line 88: `close()` doesn't clear `this.session`. Double-unregister wasteful and could cause errors.

- **LOW** | Line 90-92: `controlChannel.close()` fire-and-forget with no error handling. Could throw.

- **MEDIUM** | Line 122: `sendMessage` declared `async` but contains no `await`. Should be synchronous.

- **MEDIUM** | Line 300: `sampleRate / 100` produces non-integer for rates not divisible by 100. `Int16Array` truncates, causing drift.

- **MEDIUM** | Line 312: `Int16Array` view into shared ArrayBuffer keeps full buffer alive until GC.

- **MEDIUM** | Line 312: `combined.slice()` creates copy but underlying ArrayBuffer remains referenced. Memory leak for large bursts.

- **MEDIUM** | Line 317-318: Same shared ArrayBuffer concern — prevents timely collection.

- **MEDIUM** | Line 318: Creates view sharing same ArrayBuffer. Remainder Buffer prevents GC of original. Use `combined.slice(offset)`.

- **MEDIUM** | Line 343-351: Audio scheduler `setInterval` fires every 10ms with no backpressure. `frameQueue` grows unbounded.

- **MEDIUM** | Line 347: `sampleRate` could change while interval is running. `schedulerSampleRate` still writable.

- **MEDIUM** | Line 41: `frameQueue` unbounded. If audio produced faster than scheduler drains, unbounded memory growth.

- **MEDIUM** | Line 88-96: `close()` not idempotent — `this.session` never cleared. Second call re-unregisters.


### src/channels/websocket/WebSocketChannelHost.ts

- **HIGH** | Line 198-200: `sendError` doesn't check `ws.readyState` before `ws.send()`. Throws if socket closing/closed.

- **HIGH** | Line 63-64: `handleMessage` async but called without `await` or `.catch()`. Unhandled rejections crash process.

- **HIGH** | Line 67: `ws.on('close')` callback doesn't `await` async `handleDisconnect`. Rejections unhandled.

- **INFO** | Line 52: No validation of IP format from `x-forwarded-for`. Arbitrary strings pass through.

- **LOW** | Line 199: `requestId` always included even when `undefined`, producing `null` in JSON.

- **LOW** | Line 200: No `readyState` check before `ws.send`.

- **LOW** | Line 206-212: `close()` doesn't iterate `socketMap` to close individual connections.

- **LOW** | Line 72: `error.message` may throw if error has getter-based message. Discards stack trace.

- **MEDIUM** | Line 125: After `JSON.parse`, no guard that result is object. Array/primitive causes `undefined` type.

- **MEDIUM** | Line 148: `session?.conversationId ?? ''` — empty string ambiguous downstream.

- **MEDIUM** | Line 154: `msg: any` in `send` callback discards type safety.

- **MEDIUM** | Line 37: `parseInt` on `WS_MAX_PAYLOAD_BYTES` can return `NaN`. No fallback or validation.


### src/channels/websocket/WebSocketCommunicationChannel.ts

- **LOW** | Line 28: Empty config schema.

- **MEDIUM** | Line 27: Return type `z.ZodObject<any>` uses `any`, losing type safety.


### src/channels/websocket/WebSocketConnection.ts

- **HIGH** | Line 31: No guard against double-close. `unregisterSession` fires twice for same session.

- **HIGH** | Line 31: `this.session` never initialized. If `close()` called before `attachSession()`, throws TypeError.

- **LOW** | Line 209: Parameter type `Record<string, unknown>` too broad. Should use discriminated union.

- **LOW** | Lines 123/213: Same unguarded access.

- **LOW** | Lines 46–205: Heavy repetition across switch cases. Helper would reduce ~60 lines of duplication.

- **MEDIUM** | Line 212: Errors from `ws.send()` silently swallowed. No way to know message failed.

- **MEDIUM** | Line 31: Unguarded `this.session` access.

- **MEDIUM** | Line 43: Method declared `async` but contains no `await`. Unnecessary Promise.

- **MEDIUM** | Lines 48, 64, 174, 188: Silent early return when feature disabled. Messages dropped with no logging.

- **MEDIUM** | Lines 98, 150, 164: `.toString('base64')` on audio/image data with no guard that value is Buffer.


### src/channels/whatsapp/WhatsAppChannelHost.ts

- **HIGH** | Line 570-574: `setTimeout` callback async but promise unhandled. Unhandled rejection can crash process.

- **HIGH** | Line 93: `parseInt()` can return `NaN` if env var non-numeric. All sessions time out instantly.

- **INFO** | Line 577: `handle.unref()` prevents timeouts from blocking shutdown. Sessions may not clean up on graceful shutdown.

- **LOW** | Line 252: `(req as any).rawBody`.

- **LOW** | Line 34: `agentId` accepted as optional free-form string with no format validation.

- **LOW** | Line 401: Deprecated `substr`, non-crypto ID.

- **LOW** | Line 428: WhatsApp template language hardcoded to `en_US`. No parameter for different language.

- **LOW** | Line 446: Catch block swallows actual Meta API error detail. Hardcoded string instead of real error.

- **LOW** | Line 93: No `NaN` guard on `parseInt`.

- **MEDIUM** | Line 181: `verify_token` comparison uses `!==` instead of `timingSafeEqual`. Inconsistent with webhook signature validation.

- **MEDIUM** | Line 208: `res.status(200).json({})` fires before validation. Downstream failures invisible to Meta retry.

- **MEDIUM** | Line 252: `(req as any).rawBody` bypasses type safety. Signature validation silently fails if middleware missing.

- **MEDIUM** | Line 396-398: `updateUserProfile` awaited with no try/catch. Failure silent.

- **MEDIUM** | Line 401: `Math.random()` produces low-entropy session ID. Collision risk under load.

- **MEDIUM** | Lines 208/212-215: HTTP 200 before validation. Errors silently swallowed.


### src/channels/whatsapp/WhatsAppCommunicationChannel.ts

- **MEDIUM** | Line 27: `z.ZodObject<any>` uses `any` as type parameter, defeating type safety.


### src/channels/whatsapp/WhatsAppConnection.ts

- **HIGH** | Line 48: `this.session.id` accessed without guard — throws TypeError if `attachSession()` never called.

- **HIGH** | Line 88-90: Errors from `fetch` silently swallowed. Caller has no way to know message delivery failed.

- **INFO** | Line 23: `session` declared non-nullable but uninitialized until `attachSession()`. Should be `Session | undefined`.

- **LOW** | Line 31: `accessToken` stored as plain class property. Leaks if object serialized/logged.

- **MEDIUM** | Line 59: Early return without logging when message type isn't expected. Unclear if intentional.

- **MEDIUM** | Line 62: Early return on empty body is silent. Could mask upstream issues.

- **MEDIUM** | Line 73: No timeout on `fetch`. If Meta API hangs, promise never resolves.


### src/services/AgentService.ts

- **HIGH** | Line 108: Raw SQL interpolation of `JSON.stringify(tagsArray)`. SQL injection if untrusted input.

- **HIGH** | Line 176-187: `updateAgent` sets all fields unconditionally. `undefined` overwrites existing value with NULL.

- **INFO** | Lines 50-53/74-77/145-148/200-203/239-242/266-269/283-286: Identical catch-all boilerplate. Consider decorator.

- **INFO** | Lines 62-78: No permission check or `requireProjectNotArchived`. Security gap if controller doesn't enforce.

- **LOW** | Line 43: `agent[0]` has no null check. Crashes if empty array returned.

- **LOW** | Line 51: Error log uses `input.id` which is undefined when generated ID used.

- **LOW** | Lines 38/45/217/256/295: `context?.operatorId` uses optional chaining on required param.

- **MEDIUM** | Line 184: `fillerSettings || null` treats empty objects as falsy. Should use `??`.

- **MEDIUM** | Line 265: Multiple `as any` casts bypass type safety in `cloneAgent`.

- **MEDIUM** | Line 278: `getAgentAuditLogs` returns `any[]`. Loses type safety.

- **MEDIUM** | Lines 72/138: `isProjectActive()` issues separate DB query per call. Consider caching.


### src/services/AuditService.ts

- **HIGH** | Line 56: `auditLog[0]` crashes if `.returning()` returns empty array. No guard.

- **HIGH** | Lines 33/80/108/138: No `RequestContext` parameter. Bypasses defense-in-depth security pattern.

- **INFO** | Line 33: `logChange` accepts arbitrary `action` string with no validation.

- **LOW** | Lines 57-68/187-190/210-213/276-279: Try-catch only logs and re-throws. Boilerplate.

- **LOW** | Lines 87/116/117/145: Redundant `as Record<string, any>` casts.

- **MEDIUM** | Line 221: Return type declares `limit: number | null` but `normalizeListLimit()` always returns non-null.

- **MEDIUM** | Lines 163/171: `getEntityAuditLogs` filters on `(entityType, entityId)` but no composite index. Full table scan.

- **MEDIUM** | Lines 199/203: `getUserAuditLogs` filters on `userId` but no index. Full table scan.

- **MEDIUM** | Lines 222/277: `params` logged in full. May contain sensitive data.

- **MEDIUM** | Lines 34/58/188/211/277: `error` objects logged directly. Stack traces may leak internal details.


### src/services/ClassifierService.ts

- **HIGH** | Lines 63/279: `getClassifierById` and `getClassifierAuditLogs` have no permission checks.

- **HIGH** | Lines 73/140: Separate `isProjectActive()` query adds extra round-trip per read.

- **LOW** | Line 128: `conditions.length > 0` is dead code. Always at least length 1.

- **LOW** | Lines 109-110: `tags` filter cast doesn't validate input.

- **MEDIUM** | Line 179: `updatePayload` typed as `any`. Loses type safety.

- **MEDIUM** | Line 266: `llmSettings as any` and `tags as string[]` assert away type safety.

- **MEDIUM** | Line 279: `getClassifierAuditLogs` returns `any[]`.

- **MEDIUM** | Lines 39/46/66/166/218/257/296: `context?.operatorId` uses optional chaining on required param.

- **MEDIUM** | Lines 42/188/231: Long single-line SQL (>200 chars). Hurts readability.

- **MEDIUM** | Lines 51-54/75-78/147-150/201-204/240-243/267-270/284-287: Bare catch logs expected errors as failures.


### src/services/ConversationService.ts

- **HIGH** | Line 187: `setConversationMetadata` no permission check or `requireProjectNotArchived`.

- **HIGH** | Line 205/219: `updateConversationEventMetadata` returns `undefined` on catch instead of `null`. Type violation.

- **HIGH** | Line 232/251: `updateMessageEvent` returns `undefined` on catch instead of `null`. Type violation.

- **HIGH** | Line 56: `context` optional for write op. Missing permission check.

- **INFO** | Line 18/19: Duplicate import source. Should be single import.

- **LOW** | Line 20: Import of `meta` from `zod/v4/core` unused.

- **LOW** | Line 477/494: `context?.operatorId` — context required, optional chain redundant.

- **LOW** | Line 71: `input.status ?? 'initialized'` — fallback is dead code.

- **MEDIUM** | Line 170: Race condition — event inserted, then `lastActivityAt` updated. Not atomic.

- **MEDIUM** | Line 244: `existing.eventData as MessageEventData` — unsafe cast.

- **MEDIUM** | Line 328-330: SQL injection via `textSearch`. Unescaped `%` and `_` become wildcards.

- **MEDIUM** | Line 377/448: Magic strings duplicated. Extract to constant.

- **MEDIUM** | Line 488-492: TOCTOU race in `deleteConversation`. Fetch then delete.

- **MEDIUM** | Line 544-546/668-670: Same `textSearch` wildcard issue.

- **MEDIUM** | Line 614: `getConversationAuditLogs` returns `any[]`.

- **MEDIUM** | Line 62-90/106-138: Every method wraps in try/catch that logs and re-throws. Boilerplate.

- **MEDIUM** | Line 96-100: `saveConversationState` has no return type annotation.


### src/services/OperatorService.ts

- **[DONE] CRITICAL** | Lines 62/85/223/314/385: `operatorResponseSchema.parse(operator)` passes raw DB row with `password`. Hash leaks in response.

- **HIGH** | Line 294: Throws plain `Error` instead of typed error. Same at line 370.

- **HIGH** | Lines 197-203/354-357: `updatePayload` typed as `any` with `undefined` values. Drizzle writes NULL, overwriting data.

- **INFO** | Line 53: `.returning()` without column list. Returns all columns including password.

- **LOW** | Line 53: Variable `operator` is array but named singular. No length check.

- **LOW** | Lines 378-379: `passwordChanged` flag on old/new entity misleading.

- **MEDIUM** | Line 273: `getOperatorAuditLogs` returns `any[]`.

- **MEDIUM** | Lines 117-119: `filter as string[]` and `filter as string` unsafe casts.

- **MEDIUM** | Lines 41/58/178/239/259: `context?.operatorId` uses optional chaining on required param.

- **MEDIUM** | Lines 43-66/78-89/100-163/180-227/241-265/276-281/307-318/334-389: Uniform try/catch boilerplate.


### src/services/ProjectService.ts

- **HIGH** | Line 176: `updateData` writes fields without falling back to existing values. `undefined` overwrites with NULL.

- **HIGH** | Lines 212-325: `deleteProject` fetches all records into memory, deletes one-by-one. N DELETE queries.

- **HIGH** | Lines 69/91/431: `getProjectById`, `listProjects`, `getProjectAuditLogs` have no auth checks.

- **LOW** | Line 318: `String(issue.id)` casts to string. Inconsistent ID type.

- **LOW** | Lines 34/52/151/183/202/346/392: `context?.operatorId` uses optional chaining after permission check.

- **LOW** | Lines 48/176: Long single lines (>300 chars).

- **MEDIUM** | Line 176: `conversationTimeoutSeconds` null-coalescing inconsistent with other fields.

- **MEDIUM** | Line 431: `getProjectAuditLogs` returns `any[]`.

- **MEDIUM** | Lines 150+159: Two separate queries — `requireProjectNotArchived` then fetch. TOCTOU race.

- **MEDIUM** | Lines 57-60/80-83/130-133/188-191/328-331/374-377/420-423/436-439: Identical catch boilerplate.


### src/services/UserService.ts

- **[INTENTIONAL] HIGH** | Line 228: `ensureUserExists` — no permission check or context. Creates users without auth. (Design decision: used internally by channels to auto-create users.)

- **[DONE] HIGH** | Line 242: `userResponseSchema.parse(existing)` — `existing` can be undefined. Crashes with schema parse error. (Fixed: added null guard with `NotFoundError`.)

- **[INTENTIONAL] HIGH** | Line 256: `updateUserProfile` — no permission check or context. (Design decision: used internally by channels to inject profile data at conversation start.)

- **[INTENTIONAL] HIGH** | Line 284: `banUser` — no permission check, no context. Bypasses RBAC. (Design decision: used internally by ActionsExecutor for conversation effects.)

- **[DONE] HIGH** | Line 315: `getUserAuditLogs` — returns `any[]`. Missing permission check. (Fixed: added `context: RequestContext` param, `requirePermission(AUDIT_READ)`, return type `AuditLog[]`.)

- **LOW** | Lines 39/46/159/176/196/211: `context?.operatorId` — context required, optional chain redundant.

- **LOW** | Lines 51-54/76-79/141-144/181-184/214-217/243-246/271-274/303-306/320-323: Identical try/catch boilerplate.

- **LOW** | Lines 74/134: `isProjectActive()` adds separate query per call.

- **MEDIUM** | Line 117: `like(users.id, searchTerm)` — text-searching IDs with LIKE semantically odd.

- **MEDIUM** | Line 168: `banned: input.banned` — if undefined, sets column to NULL. Un-bans user.

- **MEDIUM** | Line 262-265: `updateUserProfile` — race condition between check and insert.

- **MEDIUM** | Line 268: `(existing.profile ?? {}) as Record<string, unknown>` — unsafe cast.


### src/services/ApiKeyService.ts

- **[DONE] CRITICAL** | Line 138: `listApiKeys` no permission check or project access. Any operator enumerates all keys.

- **[DONE] CRITICAL** | Lines 217-227/258-268: TOCTOU race in `updateApiKey`/`deleteApiKey`. Version check in app code, not SQL WHERE.

- **HIGH** | Line 286: `getApiKeyAuditLogs` returns `any[]`. No permission check.

- **HIGH** | Line 88: `getApiKeyById` no permission check or project access.

- **HIGH** | Lines 172-173: `listApiKeys` fetches data/count in parallel. Total inconsistent with data.

- **HIGH** | Lines 76/101/127/197/239/275/292: Raw error object logged. Exposes DB details/stack traces.

- **LOW** | Line 47: `getKeyPreview` calls `substring(0, 12)` without guard for short keys.

- **MEDIUM** | Line 98: `isProjectActive()` queries full row, discards everything.

- **MEDIUM** | Lines 176-181: Separate query for archived status. Latency proportional to result size.

- **MEDIUM** | Lines 61-78/91-103/116-129/141-199/216-241/257-277/289-294: All try/catch log and rethrow.


### src/services/ToolService.ts

- **[DONE] HIGH** | Line 43: `toolValues: any` — loses type safety. (Fixed: replaced with `InferInsertModel<typeof tools>`. Also fixed line 62 `context?.operatorId` → `context.operatorId`.)

- **[DONE] HIGH** | Line 62: `context?.operatorId` — context required, optional chaining inconsistent. (Fixed: removed optional chaining.)

- **[DONE] HIGH** | Line 68: `toolId: input.id` — should use computed `toolId`. Shows undefined in logs. (Fixed: uses `toolId` variable.)

- **[DONE] HIGH** | Lines 67-70/91-94/166-169/233-236/272-275/308-311: Catch-all logs expected errors as failures. (Fixed: re-throw `NotFoundError`/`OptimisticLockError` before logging.)

- **[DONE] HIGH** | Lines 67-70: If `auditService.logCreate` throws, tool persisted but method propagates failure. (Accepted: extreme edge case, best-effort audit logging is acceptable.)

- **LOW** | Line 40: `context?.operatorId` — context required, optional chain redundant.

- **LOW** | Lines 188-220/253-263: TOCTOU window between read and version-checked write.

- **MEDIUM** | Line 128: `filter as string[]`/`filter as string` — unsafe casts.

- **MEDIUM** | Line 198: `updatePayload: any` — loses type safety.

- **MEDIUM** | Line 205: Client must always send `type` to modify type-specific fields.

- **MEDIUM** | Line 298: Multiple `as any` casts bypass type checking.

- **MEDIUM** | Line 301: Non-null assertions on nullable columns. Risk of undefined values.

- **MEDIUM** | Line 305: `inputType`/`outputType` unsafe cast.

- **MEDIUM** | Line 305: `prompt!` non-null assertion on nullable column.

- **MEDIUM** | Line 332: `getToolAuditLogs` returns `any[]`.


### src/services/live/ConversationRunner.ts

- **[DONE] HIGH** | Line 1205: `receiveCommand` is a stub that throws `"Method not implemented."`. If any channel invokes this method at runtime it crashes the conversation with an unhandled plain `Error`. (Fixed: removed dead stub — no contracts or callers reference it.)

- **[DONE] HIGH** | Line 1304, 1382: `buildContextForUserInput()` called with `[/** TODO */]` — a dead-code comment inside an array literal passed as a real argument. Indicates the parameter was never filled in and the context builder receives garbage. (Fixed: replaced with new `buildContextForLifecycleAction` which takes stage as parameter, includes events/history, and omits userInput, classification results, and sample copies.)

- **[DONE] HIGH** | Line 308: `lastCompletionResult: null` — type declares optional, not nullable. Type mismatch. (Fixed: changed type to `LlmGenerationResult | null`.)

- **[DONE] HIGH** | Line 319: `agent: null as any` — explicit any cast bypasses type safety. (Fixed: changed type to `AgentResponse | null`, removed `as any`.)

- **[DONE] HIGH** | Line 364: `llmProviderEntity` may be undefined. Dereferenced without guard. (Fixed: added null guards with `NotFoundError` for classifier, transformer, guardrail classifier, and sample copy classifier LLM providers.)

- **[DONE] HIGH** | Line 365: `llmProviderEntity` used without null check. `findFirst()` returns undefined. (Fixed: see above.)

- **[DONE] HIGH** | Lines 958, 1020, 1062, 1077, 1135, 1172, 1293, 1433, 1474, 1493, 1571: All throw plain `Error` instead of a project custom error class (`InvalidOperationError`, `NotFoundError`, etc.), violating the error handling convention and making them indistinguishable from unexpected errors in the global handler. (Fixed: replaced all 18 plain `Error` throws with `InvalidOperationError`.)

- **INFO** | Line 299: `project` not null-checked before use at line 394.

- **INFO** | Line 301-322: `StageRuntimeData` with explicit undefined, then overridden. Could simplify.

- **LOW** | Line 1623: `return { status: 'completed', message: 'Action execution not yet implemented' }` — misleading. The action WAS executed above; the message is stale copy-paste text.

- **LOW** | Line 2132-2135: Two consecutive JSDoc comments. The first describes `processUserInput`, the second describes `resetTurnData`. The first is misplaced (belongs to the method below).

- **LOW** | Line 2230: Typo in comment: `classificationor` → `classification or`.

- **LOW** | Line 225: `turnData` on single 200+ char line. Hard to read.

- **LOW** | Line 2557: `this.stageData.ttsProvider !== undefined && this.stageData.ttsProvider !== null` — redundant double check. Use `!= null` or truthy.

- **LOW** | Line 269: `allSampleCopies` loaded for entire project. Memory concern for long conversations.

- **MEDIUM** | Line 1432, 1444: `setVariable()` — `variableName` is unsanitized. An attacker controlling the variable name can set `__proto__`, `constructor`, or `prototype` on `this.conversation.stageVars[stageId]`, causing prototype pollution.

- **MEDIUM** | Line 1511, 1528: `setUserProfileField()` — `fieldName` is unsanitized. Same prototype pollution vector on `updatedProfile[fieldName]`.

- **MEDIUM** | Line 1569: `parameterCount: parameters.length` — `parameters` is `Record<string, any>`, not an array. `.length` is always `undefined`, so the log is wrong.

- **MEDIUM** | Line 2257-2260: Filler LLM `setOnError` resolves `onCompletePromise` with an empty `{ content: [], finishReason: 'stop' }` result, silently swallowing the error. The caller proceeds as if generation succeeded with no text.

- **MEDIUM** | Line 2578, 2750: `(this.stageData.agent?.fillerSettings?.llmSettings as any)?.defaultMaxTokens` — `as any` cast bypasses type checking on `llmSettings`, hiding missing properties.

- **MEDIUM** | Line 261: Magic strings for conversation state. Should use typed constant.

- **MEDIUM** | Line 276-281: `conversationLifecycleActions` never cleared. Accumulates on re-init.

- **MEDIUM** | Line 2767-2806: `generateFillerSentence()` is dead code. It duplicates the logic of `prepareFillerMessages()` (lines 2725-2760) but is never called anywhere in the class.

- **MEDIUM** | Line 2925: `saveAndSendEvent(eventType: any, eventData: any)` — both parameters typed `any`. Should use a discriminated union of event types for compile-time safety.

- **MEDIUM** | Line 2931-2932: `eventData.metadata['currentVariables']` and `metadata['stageName']` unconditionally overwrite any pre-existing keys in the metadata object.

- **MEDIUM** | Line 308: `lastCompletionResult: null` vs type — incompatible under strictNullChecks.

- **MEDIUM** | Line 348-354: Iterates `globalActions` but still empty at this point. Never finds overrides.

- **MEDIUM** | Lines 327/364/377: `llmProviderEntity` can be undefined. Dereferenced without guards.


### src/services/providers/ProviderService.ts

- **HIGH** | Line 125: Raw string interpolation for JSONB. SQL injection via user-controlled input.

- **HIGH** | Line 192-201: `updatePayload` sets all fields unconditionally. Partial update overwrites with NULL.

- **INFO** | Line 101: `logger.debug({ params })` logs full params. May include sensitive values.

- **INFO** | Line 48: Single statement >300 chars.

- **INFO** | Lines 44/53/179/234/254: `context?.operatorId` — context required, optional chain redundant.

- **LOW** | Line 37: JSDoc parameters stale. Doesn't match actual schema.

- **LOW** | Line 44: `context?.operatorId` — optional chaining on required.

- **LOW** | Line 48: `secretizedConfig as typeof input.config` — unsafe cast.

- **LOW** | Lines 182-190/237-245: Redundant version checks. Racy between SELECT and UPDATE.

- **LOW** | Lines 48: `secretizedConfig as typeof input.config` — unsafe cast.

- **LOW** | Lines 58-61/85-88/161-64/218-221/257-260/309-311: Redundant try-catch boilerplate.

- **LOW** | Lines 58-61/86-88/etc: Catch-log-throw anti-pattern.

- **MEDIUM** | Line 192: `updatePayload: any`.

- **MEDIUM** | Line 192: `updatePayload` typed as `any`. Loses type safety.

- **MEDIUM** | Line 286-292: `enumerateModels` lacks try-catch. Errors propagate without logging.

- **MEDIUM** | Line 301: Returns `any[]`.

- **MEDIUM** | Line 301: `getProviderAuditLogs` returns `any[]`.

- **MEDIUM** | Lines 211-213: Audit log strips `config`. Config changes invisible in audit trail.


### src/services/EnvironmentService.ts

- **HIGH** | Line 182: Same orphaned secret issue. `storeSecret()` succeeds but `db.update()` fails.

- **HIGH** | Line 46-47: Orphaned secret on DB failure. `storeSecret()` succeeds but `db.insert()` fails.

- **INFO** | Line 92: `logger.debug({ params })` logs full params. May include sensitive values.

- **LOW** | Line 100: `columnMap` recreated every call. Should be class-level constant.

- **LOW** | Line 122: Text search columns hardcoded independently of `columnMap`. Duplication.

- **LOW** | Line 250: `getEnvironmentAuditLogs` returns `any[]`.

- **LOW** | Line 58: Error log uses `input.id` instead of computed `environmentId`.

- **MEDIUM** | Lines 167-185/219-229: TOCTOU race between read and update/delete.

- **MEDIUM** | Lines 43/52/64/164/195/216/236: `context?.operatorId` — context required, optional chain redundant.

- **MEDIUM** | Lines 45-60/72-83/94-149/166-203/218-242/253-258: Every method wraps in try/catch boilerplate.


### src/services/BaseService.ts

- **HIGH** | Line 32: `context` typed as `RequestContext | undefined`. Convention says context MUST be required.

- **INFO** | Line 61: Static log message uninformative per one-liner convention.

- **LOW** | Line 39: Logging `roles` and `requiredPermissions` on denial. Leaks auth metadata.

- **MEDIUM** | Line 50: `details: Record<string, any>` uses `any`. Should be `unknown`.

- **MEDIUM** | Line 61: Logging at `info` level in `requireProjectNotArchived`. High log volume on hot paths.

- **MEDIUM** | Line 61: `JSON.stringify(result)` logs full DB row on every write. Wasteful.


### src/services/AuthService.ts

- **HIGH** | Line 93: Login looks up operator by `id` parameter. JSDoc says email, but queries by UUID.

- **INFO** | Line 19: `BCRYPT_SALT_ROUNDS = 10`. Consider 12 for production.

- **INFO** | Line 90/115: Login logs include `roles`. Sensitive data in log aggregation.

- **LOW** | Line 126: Outer catch swallows `InvalidOperationError`. Obscures misconfiguration.

- **LOW** | Line 191: `jwtTimeToSeconds` doesn't handle `weeks` unit. Runtime crash risk.

- **MEDIUM** | Line 149: `jwt.verify()` no issuer/audience validation. Token confusion vulnerability.

- **MEDIUM** | Line 79: `expiresIn: expiresIn as any` bypasses type safety.

- **MEDIUM** | Line 90: Logging `operatorId: id` before auth succeeds. Information disclosure.


### src/services/SetupService.ts

- **HIGH** | Line 25/52: `findMany({ limit: 1 })` semantically wrong for existence check.

- **HIGH** | Line 52-63: Race condition. Concurrent requests can create duplicate operators.

- **INFO** | Line 35-38: `getSetupStatus()` try/catch crashes on DB failure. Should return degraded status.

- **INFO** | Line 63: No validation of `input.id` format. Malformed IDs reach DB.

- **LOW** | Line 48: Logs untrusted input before validation. Log injection risk.

- **LOW** | Line 84-90: Generic catch re-throws raw DB error. Should map to application error.

- **MEDIUM** | Line 47: No `RequestContext` parameter. Violates project convention.

- **MEDIUM** | Line 65: `operator[0]` no null guard. Crashes if returning empty.

- **MEDIUM** | Line 68: Passes plaintext password to `authService.login()`. Unnecessary memory retention.


### src/services/GuardrailService.ts

- **HIGH** | Line 111: Raw SQL interpolation of `JSON.stringify(tagsArray)`. Not parameterized.

- **HIGH** | Line 53-56: Catch-all swallows application errors. Expected control-flow logged as failures.

- **INFO** | Lines 66/90: `getGuardrailById`/`listGuardrails` lack `requirePermission`.

- **LOW** | Lines 41/48/165/218/237/258: `context?.operatorId` — context required, optional chain redundant.

- **LOW** | Lines 44/187: Single-line statements >300 chars.

- **MEDIUM** | Line 138: `isProjectActive` called once, spread into all items. Extra query.

- **MEDIUM** | Line 178: `updatePayload` typed as `any`. Loses type safety.

- **MEDIUM** | Line 267: `existing.effects as any` discards type information.

- **MEDIUM** | Line 267: `existing.examples as string[]` unsafe cast.

- **MEDIUM** | Line 280: `getGuardrailAuditLogs` returns `any[]`.


### src/services/GlobalActionService.ts

- **HIGH** | Line 178: `updatePayload` typed as `any`.

- **HIGH** | Line 269: Three `as any` casts bypass type safety. Type mismatch should be resolved.

- **HIGH** | Line 282: `getGlobalActionAuditLogs` returns `any[]`.

- **INFO** | Lines 179-189: Repetitive `if (updateData.X !== undefined)` pattern.

- **LOW** | Lines 42/269: Single-line statements >300 chars.

- **MEDIUM** | Line 108: Unsafe `filter as string[]` cast.

- **MEDIUM** | Lines 39/46/65/165/221/240/260: `context?.operatorId` — context required, optional chain redundant.

- **MEDIUM** | Lines 51-54/75-78/146-149/204-207/243-246/270-273: Identical bare catch boilerplate.

- **MEDIUM** | Lines 73-74/139: `isProjectActive` extra DB round-trip per request.


### src/services/KnowledgeService.ts

- **HIGH** | Line 169: Update sets all fields unconditionally. Missing fields overwrite with NULL.

- **HIGH** | Line 175: Missing `projectId` scope in post-update fetch. Potential cross-project data leak.

- **HIGH** | Line 177: Non-null assertion after unscooped fetch. Runtime crash risk.

- **LOW** | Lines 123/124: Non-null assertions on `or()` calls. Unnecessary.

- **LOW** | Lines 43/50/156/177/199/241/248/350/371/393/412: `context?.operatorId` — context required, optional chain redundant.

- **LOW** | Lines 55-58/79-82/137-140/etc: Every method has catch boilerplate. Adds noise.

- **LOW** | Lines 55/137/331/etc: Broad catch swallows Zod parse errors with DB errors.

- **MEDIUM** | Line 123: Subquery in `inArray` for every text search. Expensive on large tables.

- **MEDIUM** | Line 448: Loads ALL categories into memory, filters in JS. Should use SQL-level filtering.

- **MEDIUM** | Line 470: `getKnowledgeCategoryAuditLogs` returns `any[]`.

- **MEDIUM** | Line 487: `getKnowledgeItemAuditLogs` returns `any[]`.


### src/services/IssueService.ts

- **HIGH** | Line 240: `getIssueAuditLogs` missing `context` and permission check.

- **HIGH** | Line 60: `getIssueById` missing `context` and permission check. Defense-in-depth violation.

- **HIGH** | Line 83: `listIssues` missing `context` and permission check.

- **LOW** | Line 185: Spreads `input` with potentially undefined fields.

- **LOW** | Line 39: Insert `.values()` single 200+ char line.

- **LOW** | Line 39: `input.comments ?? ''` redundant. Schema already defaults.

- **LOW** | Lines 36/43/174/193/211/226: `context?.operatorId` — context required, optional chain redundant.

- **MEDIUM** | Line 177-185: TOCTOU race in `updateIssue`.

- **MEDIUM** | Line 214-220: TOCTOU race in `deleteIssue`.

- **MEDIUM** | Line 240: `getIssueAuditLogs` returns `any[]`.

- **MEDIUM** | Lines 39-51/63-74/86-161/176-201/213-232/243-248: Every method wraps in try/catch boilerplate.


### src/services/ModerationService.ts

- **HIGH** | Line 53-54: Provider created/initialized every call. No caching. Resource exhaustion risk.

- **HIGH** | Line 53-69: Provider never cleaned up. Resource leak.

- **HIGH** | Line 63: Error detection via `message.includes('not sensitive')`. Fragile.

- **INFO** | Line 42: No `RequestContext` parameter. Prevents auditing.

- **LOW** | Line 53: Method name misleading. Suggests enumeration, not moderation.

- **MEDIUM** | Line 47: Direct DB access instead of delegating to service.

- **MEDIUM** | Line 58: No null guard on `provider.moderateUserInput()` return.

- **MEDIUM** | Line 82: Category matching case-sensitive. Silent skip risk.

- **MEDIUM** | Lines 44/50/60/68: Duplicate literal object repeated 4 times.


### src/services/SampleCopyService.ts

- **HIGH** | Line 205: `updateData.name` can be undefined. Error message shows 'undefined'.

- **HIGH** | Line 273: Multiple unsafe `as` casts bypass type safety.

- **INFO** | Line 94: `logger.debug` logs full params. May include sensitive data.

- **LOW** | Line 48: `logCreate` without explicit `projectId`. Inconsistent.

- **LOW** | Line 53: `catch (error: any)` — should use `unknown`.

- **LOW** | Lines 41/48/65/165/198/224/243/264: `context?.operatorId` — context required, optional chain redundant.

- **LOW** | Lines 57/82/146/207/247/275/292: Raw Error object logged.

- **MEDIUM** | Line 178: `updatePayload` typed as `any`.

- **MEDIUM** | Line 286: `getSampleCopyAuditLogs` returns `any[]`.

- **MEDIUM** | Line 2: `sql` imported but never used.

- **MEDIUM** | Lines 273/44: Single lines >350 chars.

- **MEDIUM** | Lines 81-84/145-148/203-209/246-249/274-277/291-294: Catch swallows expected errors.


### src/services/CopyDecoratorService.ts

- **HIGH** | Line 124: `whereCondition` can never be undefined. Dead code.

- **HIGH** | Line 194: `updateData.name` can be undefined. Error message shows 'undefined'.

- **HIGH** | Lines 165-173/216-223: TOCTOU race between app-level and SQL-level version check.

- **LOW** | Line 39: `input.id ??` allows arbitrary ID.

- **LOW** | Lines 68/92: `getCopyDecoratorById`/`listCopyDecorators` no `RequestContext`.

- **MEDIUM** | Line 175: `updatePayload: any` discards type safety.

- **MEDIUM** | Line 247: Return type `any[]`.

- **MEDIUM** | Lines 40/47/162/187/213/232: `context?.operatorId` — context required, optional chain redundant.

- **MEDIUM** | Lines 52/192: `error: any` discards type safety.

- **MEDIUM** | Lines 78/135: Extra `isProjectActive` DB query per request.

- **MEDIUM** | Lines 80-83/142-145/235-238: Catch-all catches expected errors. Log pollution.


### src/services/VersionService.ts

- **HIGH** | Line 58: `gitCommit` resolves to `undefined`. Type expects `string | null`.

- **INFO** | Line 66: No type guard on `parsed.version`. Returns undefined for missing key.

- **LOW** | Line 78: `environment ? ... : ''` dead code. Always truthy.

- **LOW** | Line 91: Logger call inconsistent format.

- **MEDIUM** | Line 92: Inconsistent fallback format. `'unavailable'` vs hash of `'{}'`.

- **MEDIUM** | Line 95: `JSON.stringify(spec)` can throw on circular references.

- **MEDIUM** | Line 95: `JSON.stringify` key order insertion-dependent. Non-deterministic hash.


### src/services/ConversationTimeoutService.ts

- **HIGH** | Line 33: Cron handle never stored. No way to stop on shutdown.

- **HIGH** | Line 74-76: No concurrency guard. Double-abort risk.

- **HIGH** | Line 82-85: Likely duplicate event persistence.

- **INFO** | Line 68: Debug log fires every minute.

- **LOW** | Line 33: Cron schedule no explicit timezone.

- **LOW** | Line 45: `let timedOut` never reassigned. Should be `const`.

- **MEDIUM** | Line 48-61: Query has no LIMIT. OOM risk.

- **MEDIUM** | Line 52: Raw SQL instead of type-safe `eq()`.

- **MEDIUM** | Line 59: `COALESCE(lastActivityAt, updatedAt)` fallback. Non-activity updates affect timeout.

- **MEDIUM** | Line 59: `NOW()` wall-clock dependent. Clock drift risk.

- **MEDIUM** | Line 88: `sendMessage()` not wrapped in try/catch. Breaks loop.


### src/services/BenchmarkService.ts

- **HIGH** | Line 234-243: `createConfig` doesn't validate `providerConfigId`. Dangling FK.

- **HIGH** | Line 87-95: `deleteSuite` doesn't delete/check `benchmarkConfigs`. Orphaned configs.

- **HIGH** | Line 93-94: Delete before `refreshSuiteSchedule`. Cron race.

- **INFO** | Line 4: Long import line.

- **LOW** | Lines 323-339/341-384: Nearly identical methods. Duplication.

- **MEDIUM** | Line 360: `row.providerType` unsafe cast.

- **MEDIUM** | Line 377: `row.inputType` unsafe cast.

- **MEDIUM** | Lines 115-122/210-217/311-318: List methods return all rows. No operator/project filtering.

- **MEDIUM** | Lines 143/241/270: `as Record<string, unknown>` on user input.

- **MEDIUM** | Lines 348/362/363/378: Multiple `as` casts on JSON columns.


### src/services/ContextTransformerService.ts

- **HIGH** | Line 110: SQL injection via `JSON.stringify(tagsArray)`.

- **HIGH** | Line 280: `getContextTransformerAuditLogs` no permission check, no project access.

- **INFO** | Lines 63/86: `getContextTransformerById`/`listContextTransformers` no `requirePermission`.

- **LOW** | Line 42: Single-line insert >300 chars.

- **LOW** | Lines 180-187: Repetitive conditional assignments.

- **LOW** | Lines 39/46/166/219/258: `context?.operatorId` — context required, optional chain redundant.

- **MEDIUM** | Line 179: `updatePayload` typed as `any`.

- **MEDIUM** | Line 267: `as any` on `llmSettings`.

- **MEDIUM** | Lines 169-177/222-230: TOCTOU race.

- **MEDIUM** | Lines 51-54/75-78/etc: Catch-all logs expected errors as failures.


### src/services/RequestContext.ts

- **INFO** | Line 17: `timestamp` as `Date`. Consider epoch/ISO for serialization.

- **LOW** | Line 7: `operatorId` always required. `optionalAuthMiddleware` allows unauthenticated.

- **LOW** | Line 9: `roles` unconstrained `string[]`. Consider enum/union.


### src/services/BenchmarkRunService.ts


No issues found.

### src/services/BenchmarkExecutorService.ts

- **HIGH** | Line 116: No `orderBy` on pending run selection. Race condition across processes.

- **HIGH** | Line 124: No `orderBy` on config selection. Non-deterministic order.

- **HIGH** | Line 147-151: N+1 query. 2 queries per config. Should batch.

- **INFO** | Line 92: Unused parameter `_runId`.

- **LOW** | Line 101: Reset executions marked as `'failed'`. Should be `'cancelled'`.

- **LOW** | Line 166: Result object manually picks fields. New fields not persisted.

- **LOW** | Line 218: `chunkIntervals.length > 1` threshold. Single chunk produces null.

- **LOW** | Line 230: Percentile formula fragile for edge cases.

- **MEDIUM** | Line 126-130: For loop not fault-isolated. One failure stops all.

- **MEDIUM** | Line 144: Execution inserted as `in_progress` before run. Orphan risk.

- **MEDIUM** | Line 186: Shallow spread. Nested objects replaced, not merged.

- **MEDIUM** | Line 263: Invalid cron silently swallowed. Suite never fires.

- **MEDIUM** | Lines 175/180: `stats as unknown as Record`. Hides type mismatches.

- **MEDIUM** | Lines 192/196/200: Double cast `as unknown as X`. Bypasses type safety.


### src/services/ConversationStorageService.ts

- **HIGH** | Line 176: Throws bare `Error`. Breaks convention and error handler mapping.

- **HIGH** | Line 44-62: Orphaned storage. Upload succeeds but insert fails. No cleanup.

- **INFO** | Line 58: Hardcoded `data: null`. Column may be unnecessary.

- **INFO** | Lines 69-73/90-94/109-114/131-135/148-152: JSDoc stale.

- **LOW** | Line 155: `listArtifacts` missing return type.

- **LOW** | Line 179: New provider on every call. No caching.

- **LOW** | Line 64: Log includes full storage URL. Leaks sensitive paths.

- **MEDIUM** | Line 118: `expiresIn` no validation. Accepts 0/negative/large values.

- **MEDIUM** | Line 169: Raw DB lookup with no project-scoped authorization.

- **MEDIUM** | Line 37: 10 parameters. Should use options object.

- **MEDIUM** | Lines 38-40/78-80/98-100/119-121/139-141/156-158: Identical guard duplicated 6 times.

- **MEDIUM** | Lines 42/82/102/123/143/160: Unsafe `as Record` cast. No validation.


### src/services/MigrationService.ts

- **HIGH** | Line 117: `resolveBundle` called with `selection` as both first and third argument.

- **HIGH** | Line 181-199: Audit logging async. Failed audit swallowed.

- **HIGH** | Line 259/784: Plain-text credentials over HTTP. No protocol enforcement.

- **HIGH** | Line 306: `runPull` fire-and-forget. Stuck on process exit.

- **HIGH** | Line 354: `resolveBundle` with empty string hash. Inconsistent.

- **INFO** | Lines 181-199/880-1253/95-113: Massive duplication.

- **LOW** | Line 594-608: Array indexing with magic numbers.

- **LOW** | Lines 1134/1152: `operatorId: sql`null`` undocumented.

- **LOW** | Lines 254/779/693/703-707: `as any` casts. Fragile to schema changes.

- **MEDIUM** | Line 115: Logs full `selection` object. Large log lines.

- **MEDIUM** | Line 263: `authRes.json()` cast without shape check.

- **MEDIUM** | Line 476: `catch` on `decryptSecret` swallows root cause.

- **MEDIUM** | Line 551-567: 15 parallel queries fire regardless of selection.

- **MEDIUM** | Line 573-591: `inArray` with thousands of IDs. Exceeds limits.

- **MEDIUM** | Line 622-636: Some entities excluded from project ID collection.

- **MEDIUM** | Line 820: `bundlePassword` never cleaned from memory.

- **MEDIUM** | Line 849-856: `safeFetch` no timeout.

- **MEDIUM** | Line 870-878: `parseTimestamps` hardcodes field names.

- **MEDIUM** | Lines 68-69: In-memory `jobs` Map lost on restart.


### src/services/ProjectExchangeService.ts

- **HIGH** | Line 139: `transformFiller` hardcodes `historyMessageCount: 0`. Data loss.

- **HIGH** | Line 325-326: Provider hint resolution no operator filter. Cross-operator leak.

- **HIGH** | Line 60-61: Export no project ownership check. Cross-project data leak.

- **INFO** | Line 357: No duplicate detection on import.

- **LOW** | Lines 114/169/180/191/203/208/396/407/423/439/456/461/462/540: Widespread `as any`.

- **LOW** | Lines 132/139: Synthetic hints emit unnecessary DB queries.

- **LOW** | Lines 325-327: Resolution logic documents first match, code does two-step fallback.

- **MEDIUM** | Line 105: `providerType` unchecked cast.

- **MEDIUM** | Line 232-241: Guardrail export/import omits `description`. Data loss.

- **MEDIUM** | Line 325-326: 2N sequential queries for hints. Should batch.

- **MEDIUM** | Line 362: `toLocaleString()` locale-dependent. Non-deterministic.

- **MEDIUM** | Lines 379/395: `?? ''` vs `?? null`. Inconsistent. Invalid FK risk.


### src/services/live/UserInputProcessor.ts

- **HIGH** | Line 75: Hardcoded `limit: 100`. Silently truncates knowledge categories.

- **HIGH** | Lines 172/176: Non-null assertion `sampleCopyClassifier!` unsafe. Runtime crash risk.

- **HIGH** | Lines 211/219: Logger uses `session.id` as `conversationId`. Wrong ID.

- **INFO** | Lines 143-144/165-166/187-188: Sequential saves. Could batch.

- **LOW** | Line 217: Loose equality `== null`.

- **LOW** | Line 60: Magic string `'__'` filter. No explanation.

- **LOW** | Lines 130/151/173: `userInput || ''` dead code.

- **MEDIUM** | Lines 127-145/148-167/170-189: Three nearly identical blocks. Duplication.

- **MEDIUM** | Lines 196/197: `getRuntimeData()` called twice. Wastes call.

- **MEDIUM** | Lines 228-231: Catch logs and rethrows. No value.

- **MEDIUM** | Lines 260/315: `llmSettings as any`. Bypasses type safety.

- **MEDIUM** | Lines 279-290/341-353: Classifier errors silently swallowed.

- **MEDIUM** | Lines 293-354 vs 234-291: 80% identical logic. Should share template.


### src/services/live/ActionsExecutor.ts

- **HIGH** | Lines 163-176: Conflict resolution broken. Inconsistent filtering.

- **HIGH** | Lines 187-188: Clears resolvedEffects, discarding prior deduplication.

- **HIGH** | Lines 202-211: Double-pushing when both go_to_stage and end_conversation conflicts exist.

- **INFO** | Line 847: Internal variable key not namespaced.

- **INFO** | Lines 247-257: Returns `shouldGenerateResponse: true` for empty actions. Undocumented.

- **LOW** | Line 400: Unresolved design decision. Swallows errors.

- **LOW** | Line 462: Error message lacks effect type.

- **MEDIUM** | Line 438: Emits `context.vars as any`. Leaks internal keys.

- **MEDIUM** | Line 445: Emits `context.userProfile as any`. Exposes full profile.

- **MEDIUM** | Line 506: Mutates `context.stage.id` directly. Shared state issue.

- **MEDIUM** | Line 534: Mutates `context.userInput` directly. Shared state issue.

- **MEDIUM** | Line 704: Fire-and-forget async IIFE. Unhandled rejection risk.

- **MEDIUM** | Lines 700-701: `JSON.parse(JSON.stringify())` drops Date/Map/Set/etc.

- **MEDIUM** | Lines 783-798: Event after result stored. No rollback.


### src/services/live/ToolExecutor.ts

- **[DONE] CRITICAL** | Lines 127/145: SSRF via `renderedUrl`. No URL scheme validation. (Fixed: added URL parse + http/https-only check at line 129-137.)

- **[DONE] CRITICAL** | Lines 158/161: Webhook `success: true` regardless of HTTP status. (Fixed: added `response.ok` check at line 172, returns `success: false` with HTTP status failure reason.)

- **HIGH** | Line 145: `fetch()` no timeout. Hangs indefinitely.

- **HIGH** | Line 99: `llmSettings as any`. Bypasses type safety.

- **HIGH** | Lines 223/234: `any[]` cast and `value: any`.

- **HIGH** | Lines 77/119/175: Throws bare `Error`. Breaks convention.

- **LOW** | Line 95: Hardcoded user message. Not configurable.

- **LOW** | Line 99: Magic string `'tool'`.

- **LOW** | Lines 106/161/199/110/165: Single-line returns >200 chars.

- **MEDIUM** | Line 129: `Content-Type` hardcoded. Template may render non-JSON.

- **MEDIUM** | Line 139: Body only for POST/PUT/PATCH. DELETE body dropped.

- **MEDIUM** | Line 143: `renderedUrl` logged. May contain credentials.

- **MEDIUM** | Line 90: `renderedPrompt` logged. May contain secrets.

- **MEDIUM** | Lines 110/165/199: `error.message ??` — empty string bypasses fallback.


### src/services/live/ResponseGenerator.ts

- **INFO** | Line 30: `history.at(-1)` requires Node 16.6+.

- **LOW** | Line 26: 9 parameters. Consider options object.

- **LOW** | Line 27: Unnecessary block body with explicit return.

- **MEDIUM** | Line 36: `context.userInput ?? '---'`. Sends meaningless content to LLM.

- **MEDIUM** | Line 43: `maxTokens !== undefined`. Doesn't guard against 0.

- **MEDIUM** | Lines 26-44: No error handling around `generateStream()`.


### src/services/live/IsolatedScriptExecutor.ts

- **HIGH** | Line 182: `formatDate` no validation. Throws on invalid input.

- **HIGH** | Line 221: `stageMessages` no null guard on `events`. Crashes.

- **HIGH** | Lines 217-218: `historyContains` no type guards. Crashes on non-string.

- **HIGH** | Lines 240-249: `release()` not in try-finally. Reference leak.

- **INFO** | Line 114: No validation on `code` parameter.

- **LOW** | Line 154: `console` missing `info`, `trace`, `debug`.

- **LOW** | Line 182: `formatDate` options type mismatch.

- **LOW** | Line 213: Non-string content produces `[object Object]`.

- **LOW** | Lines 142/146/150: `args.join(' ')` renders objects as `[object Object]`.

- **LOW** | Lines 169/170: `events`/`consts` undocumented.

- **MEDIUM** | Line 162: History deep-copied every execution. Expensive.

- **MEDIUM** | Line 190: `goToStage` no validation on `stageId`.

- **MEDIUM** | Line 277: Script errors silently swallowed.

- **MEDIUM** | Lines 118-119/266-268: `JSON.stringify` comparison order-dependent.

- **MEDIUM** | Lines 253-263: Convoluted logic with likely dead code.


### src/services/live/TemplatingEngine.ts

- **HIGH** | Line 42: `get` helper returns `result || ''`. Loses 0/false/"".

- **HIGH** | Line 89: `default` helper uses `||`. Treats 0/false/"" as falsy.

- **HIGH** | Lines 242-243: Template injection. Rendered output re-compiled as Handlebars.

- **INFO** | Lines 241-247: Double-pass rendering fragile.

- **LOW** | Line 253: Error re-throw loses stack trace.

- **LOW** | Lines 104-107: `jsonEscape` produces `[object Object]` for objects.

- **LOW** | Lines 159-177: `and`/`or` with zero args unexpected results.

- **LOW** | Lines 98-99: `json` fallback `String(value)` produces `[object Object]`.

- **MEDIUM** | Line 237: `render` declared async but no await.

- **MEDIUM** | Lines 189-200: `helperMissing` suppresses errors. Masks bugs.

- **MEDIUM** | Lines 217-221: Cache eviction FIFO, not LRU.


### src/services/live/SpeechCompletionDetector.ts

- **[DONE] CRITICAL** | Line 47: Regex `[.!?]` includes `'`. Matches apostrophes as sentence endings. (Fixed: removed ASCII apostrophe from optional closing character class at line 47.)

- **HIGH** | Line 96: Docstring says "single word" is fragment, but returns false.

- **HIGH** | Lines 55/61/75/88/101: `Set` literals recreated every call. Should be static.

- **INFO** | Line 47: Unicode closer asymmetry.

- **INFO** | Line 88: `'so'` in both `fillers` and `conjunctions`.

- **LOW** | Line 16: Empty input returns `'ambiguous'`.

- **LOW** | Line 47: Abbreviations produce false positives.

- **MEDIUM** | Line 114: `getLastWord` strips punctuation. Downstream checks blind.

- **MEDIUM** | Line 11: Lacks `@injectable()` decorator.

- **MEDIUM** | Line 47: Missing ellipsis handling.

- **MEDIUM** | Lines 47-117: Heuristics are English-only and fragile. Words like "so", "when", "where", "as" are treated as incomplete endings but are common in complete utterances ("So" as an answer, "When" as a question). Fragment detector (line 96) returns `false` for single words, so a lone "so" or "if" falls through to `ambiguous` rather than being caught as incomplete. No language detection — non-English transcripts will produce incorrect verdicts with no fallback.


### src/services/live/ContextTransformerExecutor.ts

- **HIGH** | Line 268: `rawResponse` serializes entire LLM response. MB of data.

- **HIGH** | Lines 117-120: In-memory state mutated before DB write. No rollback.

- **HIGH** | Lines 147-148: Sequential await loop no error handling.

- **HIGH** | Lines 245-246: `string` typed, initialized to `null`. Type error.

- **INFO** | Line 289: Single-line return with many properties.

- **LOW** | Line 103: `Promise.all` aborts all on single failure.

- **LOW** | Line 293: `String(error)` discards stack.

- **MEDIUM** | Line 139: Full stage var snapshot in every event. Should store delta.

- **MEDIUM** | Line 181: `JSON.stringify` comparison fragile.

- **MEDIUM** | Line 263: `llmSettings as any`. Bypasses type safety.

- **MEDIUM** | Lines 254/270/202: Logs at INFO level. Excessive volume.


### src/services/live/ConversationRecorder.ts

- **HIGH** | Line 68: `isFlushing` never reset. Subsequent calls no-op.

- **HIGH** | Lines 116-117: Chunks cleared on failure. Silent data loss.

- **HIGH** | Lines 82-114: No await on converter drain. Truncated recordings.

- **LOW** | Line 7: Type declared before imports.

- **LOW** | Lines 93/110: `conversationId` logged redundantly.

- **MEDIUM** | Line 31: Unsafe cast `format as AudioFormat`.

- **MEDIUM** | Lines 120-125: `destroy()` doesn't prevent subsequent pushes.

- **MEDIUM** | Lines 39/44: `initialize()` registers duplicate listeners.

- **MEDIUM** | Lines 82-114: Duplicated upload logic.


### src/services/live/ConversationContextBuilder.ts

- **[DONE] CRITICAL** | Line 387: `.filter(async (async callback))`. Every action passes filter. (Fixed: replaced with explicit `for` loop with per-entry `await`.)

- **HIGH** | Line 1: `param` imported but never used.

- **HIGH** | Lines 273-275: UTC offset calculation fragile.

- **HIGH** | Lines 537/599/661/1064: `stage!` non-null assertion. Can be null.

- **HIGH** | Lines 587/703/789/871/961/1040: `stage as any`. Bypasses type safety.

- **INFO** | Lines 105-108/111: `Record<string, any>` everywhere.

- **INFO** | Lines 242-270: 7+ `Intl.DateTimeFormat` instances.

- **LOW** | Line 1099: `userProfile || {}` dead code.

- **LOW** | Line 91: `metadata?: Record<string, any>`.

- **LOW** | Lines 758/1028: Inconsistent query style.

- **MEDIUM** | Line 419: Missing return type annotation.

- **MEDIUM** | Lines 497-1082: Massive duplication across 8 methods.

- **MEDIUM** | Lines 534/596/658/713/809/886/973/1061: `metadata?.timezone as string` cast.

- **MEDIUM** | Lines 537/599/661/1064: `buildProjectContext` called twice per method.

- **MEDIUM** | Lines 545-551/607-613/723-729/827-833/896-902/984-990/1072-1078: Identical block duplicated 7 times.

- **MEDIUM** | Lines 549/609/727/831/899/987/1075: `eventData as ConversationEventData` unsafe.


### src/services/live/SampleCopyDistributor.ts

- **HIGH** | Line 66: Biased shuffle. `sort(() => 0.5 - Math.random())` not uniform.

- **HIGH** | Lines 81-82: Division by zero when `copies` empty. `NaN` index.

- **INFO** | Line 10: Typo "conversations" -> "conversation".

- **LOW** | Lines 50-56: `if/else if/else` instead of exhaustive switch.

- **MEDIUM** | Line 49: No validation that `targetLength` positive.

- **MEDIUM** | Line 67: `copies.length < targetLength` silently returns fewer items.

- **MEDIUM** | Lines 43-56: `sampleCopyId` used as key into `copyStates` by name.


### src/services/live/HistoryBuilder.ts

- **HIGH** | Line 44: No validation that `event.timestamp` defined.

- **HIGH** | Line 44: `localeCompare` for timestamp sorting. Semantically wrong.

- **INFO** | Line 44: Spreading `allEvents` doubles memory.

- **LOW** | Line 105: `result.value` no shape check.

- **LOW** | Line 94: `context.stage` no optional chaining.

- **MEDIUM** | Line 43: `allEvents` not guarded against null/undefined.

- **MEDIUM** | Line 66: `eventData.text` no null-check.

- **MEDIUM** | Line 67: `eventData.role` not validated.

- **MEDIUM** | Lines 51/57/64: Raw `as` casts on `eventData`.


### src/services/live/effectValueTransformer.ts

- **HIGH** | Line 72: Uses `value[0]` instead of `trimmed[0]`. Leading space bypass.

- **INFO** | Line 72: `value[0] === '='` should use `startsWith`.

- **LOW** | Line 37: `[^.]+` prevents matching variable names with dots.

- **LOW** | Line 53: Returns `result[0]` for array. Silently undefined for empty.

- **MEDIUM** | Line 75: `result.value` no null guard.

- **MEDIUM** | Lines 35-41: Regex patterns recompiled every call.


### src/services/live/ModifyVariablesEffectExecutor.ts

- **HIGH** | Line 47: `reset` assigns `undefined` instead of `delete`.

- **HIGH** | Lines 40/47/57/60/72: Prototype pollution. No sanitization.

- **HIGH** | Lines 87-90: Partial mutation on failure. No rollback.

- **INFO** | Lines 28/86: Log messages redundant.

- **LOW** | Line 86: Success log reports count but doesn't distinguish no-ops.

- **MEDIUM** | Line 35: Raw value logged. May expose sensitive data.

- **MEDIUM** | Line 71: `JSON.stringify` O(N*M) performance.

- **MEDIUM** | Line 71: `JSON.stringify` comparison fragile.

- **MEDIUM** | Line 73: `hasModifiedVars` set unconditionally on remove.


### src/services/live/ModifyUserProfileEffectExecutor.ts

- **[DONE] HIGH** | Line 36: PII logged at INFO level. (Fixed: removed `value` from INFO log — `fieldName` and `operation` remain for debugging.)

- **[DONE] HIGH** | Line 72: `JSON.stringify` comparison crashes on circular refs. (Fixed: wrapped in try-catch, falls back to `!==` for non-serializable values.)

- **INFO** | Line 31: Partial mutation on failure.

- **LOW** | Line 72: `JSON.stringify` O(n*m) performance.

- **LOW** | Lines 30/36: Two INFO logs per modification.

- **MEDIUM** | Line 48: `reset` sets `undefined` instead of `delete`.

- **MEDIUM** | Line 72: `hasModifiedUserProfile` set unconditionally.

- **MEDIUM** | Lines 41/48/58/60/73: `fieldName` no sanitization. Prototype pollution.


### src/index.ts

- **HIGH** | Line 42: `startServer(port)` not awaited. Unhandled rejection.

- **LOW** | Lines 21/34: Logging raw error objects. Leaks internals.

- **LOW** | Lines 47-49: No graceful shutdown handling.

- **MEDIUM** | Line 41: No validation that `parseInt` produces valid number.

- **MEDIUM** | Line 48: Uses `console.error` instead of `logger`.

- **MEDIUM** | Lines 29-31: `LocalSecretsManager` double-registration risk.


### src/server.ts

- **HIGH** | Line 111: Logging every request at INFO. Massive log volume.

- **HIGH** | Line 96: `credentials: true` with `origin: '*'`. Security anti-pattern.

- **HIGH** | Lines 277-279: `createApp()` starts background services. Coupled side effects.

- **INFO** | Lines 271-275: Channel host setup scattered.

- **LOW** | Line 289: `startServer` returns `void`. No graceful shutdown.

- **LOW** | Line 89: `req: any` in verify callback.

- **LOW** | Lines 116-124: Swagger UI without auth.

- **MEDIUM** | Line 111: `req.url` logged. Exposes sensitive params.

- **MEDIUM** | Line 290: Default port hardcoded. Ignores `PORT` env.

- **MEDIUM** | Line 298: `TwilioVoiceChannelHost` resolved twice.

- **MEDIUM** | Lines 135-137/143-145: `new URL()` + `fileURLToPath()` every request.

- **MEDIUM** | Lines 167-269: Extreme duplication. 40+ identical pairs.


### src/errors.ts

- **INFO** | Lines 1-154: Heavy repetition.

- **INFO** | Lines 157-164: `ValidationErrorDetail` tight coupling to Zod.

- **LOW** | Line 171: `details` not readonly.

- **LOW** | Lines 8/18/28/38/48/58/68/78/88/98/108/118/128/141/152: Hardcoded `this.name`.

- **MEDIUM** | Lines 1-178: No shared base class. Error handler duplicates mapping.

- **MEDIUM** | Lines 5-154: All error classes lack `Object.setPrototypeOf`. Breaks `instanceof`.


### src/permissions.ts

- **HIGH** | Line 269: `getPermissionsForRoles` accepts `string[]`. Invalid roles swallowed.

- **HIGH** | Line 288: `hasPermission` accepts `string[]`. Invalid roles swallowed.

- **HIGH** | Line 299: `hasAllPermissions` accepts `string[]`. Invalid roles swallowed.

- **HIGH** | Line 310: `hasAnyPermission` accepts `string[]`. Invalid roles swallowed.

- **INFO** | Line 136: `as const` doesn't deep freeze.

- **LOW** | Line 105: `SECRETS_REVEAL` no `SECRETS_WRITE`.

- **LOW** | Line 124: `BENCHMARK_RUN` breaks naming convention.

- **LOW** | Line 127: `SYSTEM_CONFIG` breaks naming convention.

- **LOW** | Lines 99-100: `MIGRATION_EXPORT`/`MIGRATION_IMPORT` break naming convention.

- **MEDIUM** | Line 144: `content_manager` description misleading.

- **MEDIUM** | Lines 177-178: `content_manager` has SECRETS_READ/DELETE but not REVEAL.

- **MEDIUM** | Lines 269-312: Rebuilds Set every call. Hot path.


### src/IpRateLimiter.ts

- **HIGH** | Lines 66-70: `pruneExpired` mutates Map during iteration. Skips entries.

- **INFO** | Line 18: Class name suggests general-purpose, scoped to WS auth.

- **LOW** | Line 28: Prune runs once per windowMs. Map grows large.

- **MEDIUM** | Lines 18-72: No `destroy()`/`dispose()`. Interval leak.

- **MEDIUM** | Lines 25-26: No validation for positive values.


### src/http/middleware/auth.ts


No issues found.

### src/http/middleware/errorHandler.ts

- **[DONE] CRITICAL** | Line 11: `JSON.parse(err.message)` crashes. ZodError.message not JSON.

- **HIGH** | Line 9: `err: any` loses type safety.

- **INFO** | Lines 34/35/69/70: `ForbiddenError`/`AccessDeniedError` both 403.

- **LOW** | Line 74: `err.status` duck-typing unsound.

- **LOW** | Line 79: `err.stack`/`err.message` may be undefined.

- **MEDIUM** | Line 79: Logging `err` directly. Leaks sensitive data.

- **MEDIUM** | Lines 29-72: Heavy duplication. 12 identical branches.


### src/http/middleware/rateLimiter.ts

- **[DONE] CRITICAL** | Lines 16/37: `ipKeyGenerator` expects Request, called with string. (False positive — `ipKeyGenerator` takes a string IP, not a Request. Original code was correct.)

- **LOW** | Line 12: `createAuthRateLimiter` may be unused.

- **LOW** | Lines 19/40: `_res` unused. Could set Retry-After header.

- **MEDIUM** | Line 36: `skip` hardcodes paths. Not validated against routes.


### src/http/middleware/requestContext.ts

- **HIGH** | Line 28: `req.socket.remoteAddress` type narrowing gap.

- **HIGH** | Line 30: No error handling around `generateId()`.

- **INFO** | Line 22: Function name misleading.

- **LOW** | Line 4: `type` import unnecessary in global block.

- **LOW** | Lines 6-16: Global augmentation duplicates auth middleware.

- **MEDIUM** | Line 29: `userAgent` no sanitization. Breaks structured logging.

- **MEDIUM** | Line 30: `requestId` format differs from `operatorId`.

- **MEDIUM** | Lines 24-33: Unauthenticated requests no `req.context`.


### src/swagger.ts

- **INFO** | Lines 110-114: Benchmark imports always execute.

- **INFO** | Lines 115-119: Channel host imports trigger side effects.

- **INFO** | Lines 339-685: Schema registration scattered.

- **LOW** | Line 1: Redundant `import 'reflect-metadata'`.

- **LOW** | Lines 696-701: Hardcoded server URL.

- **MEDIUM** | Line 122: `extendZodWithOpenApi` runs eagerly.

- **MEDIUM** | Line 124: `cachedOpenAPISpec` typed as `any`.

- **MEDIUM** | Line 130: `getOpenAPISpec()` returns `any`.

- **MEDIUM** | Lines 339-685: Extreme duplication. 30+ identical blocks.


### src/http/controllers/AuthController.ts

- **HIGH** | Line 96: Logs `body.id` before auth. Timing attack vector.

- **LOW** | Line 94: Docstring says email, code uses `body.id`.

- **LOW** | Lines 98/108: No handling if service returns null.

- **MEDIUM** | Line 96: `this.authService ?` dead code. Always truthy.

- **MEDIUM** | Lines 105-109: `refresh` no logging. Security audit gap.

- **MEDIUM** | Lines 46-48/74-76: OpenAPI missing 400 responses.


### src/http/controllers/OperatorController.ts

- **HIGH** | Lines 298-300: `getProfile` no permission check. Unauthenticated access.

- **HIGH** | Lines 307-310: `updateProfile` no permission check.

- **INFO** | Lines 298-300: Only handlers without `checkPermissions`.

- **LOW** | Line 7: `UpdateOperatorRequest` unused import.

- **MEDIUM** | Line 221: Route ordering. Audit-logs after `:id`.

- **MEDIUM** | Line 232: Zod `.parse()` throws. Should use `.safeParse()`.

- **MEDIUM** | Line 31: Schema requires `id`. Contradicts "auto-generated" doc.


### src/http/controllers/ProjectController.ts

- **HIGH** | Line 275: Redundant type assertion. Masks schema drift.

- **INFO** | Line 223: Route ordering fragile.

- **LOW** | Lines 298/310: Redundant casts.

- **MEDIUM** | Line 259: Logger before `checkPermissions`. Audit noise.

- **MEDIUM** | Lines 250/263/321: No `req.context`. No audit trail.

- **MEDIUM** | Lines 259-262: Two INFO logs per request. Excessive volume.


### src/http/controllers/ConversationController.ts

- **HIGH** | Line 282: Reversed parameter order. Error-prone.

- **INFO** | Line 282: Only handler using `AUDIT_READ`.

- **LOW** | Line 63: OpenAPI missing 404.

- **LOW** | Lines 317-319: No `Content-Length` header.

- **MEDIUM** | Line 318: `Content-Disposition` no file extension.

- **MEDIUM** | Lines 218/229/241/252/264/275/286/298/309: JSDoc routes wrong.

- **MEDIUM** | Lines 222-319: Read ops no `req.context`. No service-layer checks.


### src/http/controllers/AgentController.ts

- **HIGH** | Line 228: `getAgentById` no `req.context`. Defense-in-depth gap.

- **HIGH** | Line 241: `listAgents` no `req.context`.

- **HIGH** | Line 276: `getAgentAuditLogs` reversed parameter order.

- **INFO** | Lines 49-50/120-122/etc: OpenAPI missing 403 responses.

- **LOW** | Lines 210/222/233/246/258/270/281: JSDoc routes wrong.

- **MEDIUM** | Line 237: Logs raw query. May contain sensitive data.


### src/http/controllers/StageController.ts

- **INFO** | Line 275: `getStageAuditLogs` returns `any[]`.

- **INFO** | Lines 228/240: Read ops no `req.context`.

- **LOW** | Line 7: Unused type imports.

- **LOW** | Lines 210/222/233/245/257/269/280: JSDoc routes wrong.

- **MEDIUM** | Lines 24-52/74-93: OpenAPI missing `request.params` for `projectId`.


### src/http/controllers/UserController.ts

- **HIGH** | Line 189: `getUserById` no `req.context`.

- **HIGH** | Line 201: `listUsers` no `req.context`.

- **HIGH** | Line 235: `getUserAuditLogs` no `req.context`.

- **INFO** | Line 163: Route registration order.

- **LOW** | Line 315: `getUserAuditLogs` returns `any[]`.

- **MEDIUM** | Line 235: Inconsistent parameter order.

- **MEDIUM** | Lines 201/235: No archive check.


### src/http/controllers/ProviderController.ts

- **[DONE] CRITICAL** | Line 206: `createdBy` client-settable. Operator impersonation. (Fixed: removed from create schema, service always uses `context.operatorId`.)

- **HIGH** | Lines 237-242: TOCTOU race in `updateProvider`.

- **INFO** | Lines 205/216/227/238/250/263/274: Redundant permission checks.

- **INFO** | Lines 273-277: OpenAPI missing 502.

- **LOW** | Lines 206/59-60: Error log uses `input.id`. Undefined risk.

- **LOW** | Lines 21-184: OpenAPI missing 403 responses.

- **MEDIUM** | Line 237-242: `updatePayload` typed as `any`.

- **MEDIUM** | Line 265: `getProviderAuditLogs` returns `any[]`.

- **MEDIUM** | Lines 204-277: `req.context` not typed on Request.


### src/http/controllers/ClassifierController.ts

- **HIGH** | Line 227: `getClassifierById` no `req.context`.

- **LOW** | Lines 148-161: OpenAPI missing 400.

- **LOW** | Lines 209/221/232/244/256/268/279: JSDoc routes wrong.

- **MEDIUM** | Line 274: `getClassiferAuditLogs` returns `any[]`.

- **MEDIUM** | Line 7: `CloneClassifierRequest` unused import.


### src/http/controllers/ToolController.ts

- **LOW** | Lines 215/238: Inconsistent destructuring patterns.

- **MEDIUM** | Line 228: `getToolById` no `context`. Audit trail gap.

- **MEDIUM** | Line 275: Inverted argument order vs convention.

- **MEDIUM** | Lines 210/222/233/245/257/269/280: JSDoc routes missing `/api/projects/:projectId` prefix.


### src/http/controllers/EnvironmentController.ts

- **[DONE] CRITICAL** | Lines 245-246: Route ordering bug. `/api/environments/:id/migration/jobs/:jobId` before `/api/environments/:id/migration/scope`. Scope endpoint unreachable — `:jobId` captures "scope". (False positive — different segment counts, no conflict.)

- **HIGH** | Lines 321-328/346-352: `startPull`/`previewScope` no environment existence check.

- **HIGH** | Lines 326-327: `getJob` returns `undefined`. Sent as `null` with 202. No null check.

- **LOW** | Lines 253-352: OpenAPI missing 403 responses.

- **MEDIUM** | Line 334: Handler `async` but no `await`.

- **MEDIUM** | Line 334: `getJob` checks `MIGRATION_IMPORT` but not `ENVIRONMENT_READ`. Indirect environment ID discovery.

- **MEDIUM** | Lines 267/278/313: Read ops no `req.context`.


### src/http/controllers/ApiKeyController.ts

- **HIGH** | Line 216: `getApiKeyById` no `context`. No service-layer permission enforcement.

- **HIGH** | Line 216: `getApiKeyById` no archive check. Reads from archived projects.

- **HIGH** | Line 270: `getApiKeyAuditLogs` no `context`. No service-layer enforcement.

- **HIGH** | Lines 227/237: `listApiKeys` no `context`. No service-layer enforcement.

- **INFO** | Line 204: No UUID validation on `projectId`.

- **MEDIUM** | Line 237: `listAllApiKeys` passes `undefined` projectId. Workspace-wide key enumeration.

- **MEDIUM** | Line 270: `getApiKeyAuditLogs` no ownership cross-check.

- **MEDIUM** | Lines 247/258: Redundant type casts.


### src/http/controllers/GuardrailController.ts

- **INFO** | Line 263: DELETE requires JSON body. Interoperability issues.

- **LOW** | Line 7: Unused type imports.

- **LOW** | Lines 201-202: Unconventional route registration order.

- **MEDIUM** | Lines 225-229: `getGuardrailById` no project access check. Cross-project enumeration.

- **MEDIUM** | Lines 228/236/275: Read ops no `req.context`.

- **MEDIUM** | Lines 236-241: `listGuardrails` same gap. Cross-project enumeration.

- **MEDIUM** | Lines 272-277: `getGuardrailAuditLogs` no project access. Cross-project audit enumeration.


### src/http/controllers/GlobalActionController.ts

- **HIGH** | Lines 228/240/275: Read ops no `req.context`. No project-level access control.

- **INFO** | Line 228: Service signature doesn't accept context.

- **LOW** | Line 6: Long import line (130+ chars).

- **LOW** | Lines 217/252/264/287: `req.context` no type assertion.

- **MEDIUM** | Line 263: DELETE requires JSON body. Non-standard (RFC 9110).

- **MEDIUM** | Line 275: Returns `any[]`. No type safety.

- **MEDIUM** | Lines 213/225/236/248/260/272/283: JSDoc routes missing `/api/projects/:projectId` prefix.


### src/http/controllers/BenchmarkConfigController.ts

- **LOW** | Line 83: Redundant `as CreateBenchmarkConfigRequest` cast.

- **LOW** | Line 98: Redundant `as UpdateBenchmarkConfigRequest` cast.

- **LOW** | Lines 27-31/40-43/52-56/65-69: OpenAPI missing 401/403/429 responses.


### src/http/controllers/BenchmarkSuiteController.ts

- **LOW** | Line 114: Redundant `as CreateBenchmarkSuiteRequest` cast.

- **LOW** | Line 129: Redundant `as UpdateBenchmarkSuiteRequest` cast.


### src/http/controllers/BenchmarkProviderConfigController.ts


No issues found.

### src/http/controllers/BenchmarkRunController.ts

- **INFO** | Line 113: Schema describes `id` as "Benchmark config ID" but is actually config execution ID.

- **LOW** | Line 92: Redundant `as TriggerBenchmarkRunRequest` cast.

- **LOW** | Lines 38-41: OpenAPI missing 400 for `listRuns`.

- **LOW** | Lines 56-64: OpenAPI missing 404 for `getResults`.


### src/http/controllers/MigrationController.ts


No issues found.

### src/http/controllers/FunnelController.ts

- **[DONE] CRITICAL** | Line 179: `projectId` parsed from `req.query` instead of `req.params`. Route defines `:projectId` as URL param. Zod validation fails for correct clients. (Fixed: parse from `req.params`, removed from query schema.)

- **LOW** | Line 179: `funnelQueryParamsSchema` redundantly declares `projectId`. Split source-of-truth.


### src/http/controllers/ScenarioController.ts

- **LOW** | Line 202: No scenario existence check before audit logs.

- **LOW** | Line 202: Reversed parameter order.

- **MEDIUM** | Line 168: `listScenarios` no `req.context`.

- **MEDIUM** | Line 175: `getScenarioById` no `req.context`.


### src/http/controllers/TesterController.ts

- **LOW** | Line 53: OpenAPI missing `projectId` path parameter.

- **MEDIUM** | Lines 199-203: `getTesterAuditLogs` no existence check. Returns 200 with empty array for non-existent testers. OpenAPI 404 unreachable.


### src/http/controllers/ScenarioConversationController.ts

- **LOW** | Line 15: `id` no `.min(1)`. Allows empty string.

- **LOW** | Lines 68/76: Uses `SCENARIO_RUN_READ` instead of dedicated permission.

- **MEDIUM** | Line 71: `listScenarioConversations` no `RequestContext`.

- **MEDIUM** | Line 78: `getScenarioConversationById` no `RequestContext`.

- **MEDIUM** | Lines 67-73: No project access check. Cross-project enumeration.


### src/http/controllers/ScenarioRunController.ts

- **HIGH** | Line 192: `listScenarioRuns` no `req.context`.

- **HIGH** | Line 199: `getScenarioRunById` no `req.context`.

- **HIGH** | Line 222: `req.context?.operatorId` optional chaining allows `undefined`. Bypasses authorization.

- **HIGH** | Line 230: `deleteScenarioRun` no `req.context`. Defense-in-depth gap.

- **LOW** | Lines 203/208: `async` but no `await`.

- **MEDIUM** | Line 184: `notifyNewRun` unhandled exception. Request hangs.

- **MEDIUM** | Line 223: `signalCancel` unhandled exception.

- **MEDIUM** | Lines 222/230: Inconsistent argument order.


### src/http/controllers/SecretController.ts


No issues found.

### src/http/controllers/AnalyticsController.ts

- **LOW** | Line 232: Redundant `as SliceQuery` cast.

- **MEDIUM** | Line 221: `getSourceCatalog` no project validation. Any user with `ANALYTICS_READ` reaches endpoint for non-existent project.


### src/http/controllers/SavedSliceQueryController.ts


No issues found.

### src/http/controllers/SampleCopyController.ts

- **LOW** | Line 286: Returns `any[]`.

- **LOW** | Line 6: Import exceeds 250 chars.

- **LOW** | Lines 217/252/264/287: `req.context` no type guards.

- **MEDIUM** | Line 275: OpenAPI 404 unreachable. Service never verifies sample copy existence.

- **MEDIUM** | Lines 24-52: OpenAPI missing `request.params` for `projectId`.

- **MEDIUM** | Lines 74-94: OpenAPI missing `request.params` for `projectId`.


### src/http/controllers/CopyDecoratorController.ts

- **HIGH** | Lines 198/210: Read ops no `req.context`. No `checkProjectAccess`. Cross-project enumeration.

- **MEDIUM** | Lines 187/222/234/245: `req.context` no null guard.

- **MEDIUM** | Lines 198/210: Inconsistent context usage. Write passes, read doesn't.


### src/http/controllers/KnowledgeController.ts

- **LOW** | Line 7: Import exceeds 300 chars.

- **LOW** | Lines 363/375/387/398/409/425/437/448/460/472/485: JSDoc routes missing `/api/projects/:projectId/` prefix.

- **LOW** | Lines 502/513: Reversed parameter order.


### src/http/controllers/ContextTransformerController.ts

- **LOW** | Line 2: Unused import `NextFunction`.

- **LOW** | Line 7: Unused import `CloneContextTransformerRequest`.

- **LOW** | Lines 209/221/232/244/256/268/279: JSDoc routes incomplete.

- **LOW** | Lines 22-192: OpenAPI missing `projectId` path parameter.


### src/http/controllers/IssueController.ts

- **LOW** | Line 240: Returns `any[]`.

- **LOW** | Lines 184/207/218/229: `parseInt` produces `NaN` for non-numeric strings.

- **MEDIUM** | Line 184: `getIssueById` no `req.context`.

- **MEDIUM** | Line 195: `listIssues` no `req.context`.

- **MEDIUM** | Line 229: `getIssueAuditLogs` no `req.context`.


### src/http/controllers/ProjectExchangeController.ts


No issues found.

### src/http/controllers/VersionController.ts

- **LOW** | Line 43: `async` but no `await`.


### src/http/controllers/SetupController.ts

- **[DONE] CRITICAL** | Lines 72-74: Setup routes before rate-limiting middleware. Unlimited brute-force on initial operator creation.

- **HIGH** | SetupService.ts:63-68: If `authService.login()` fails after operator insert, setup blocked. Orphan account with no recovery.

- **HIGH** | SetupService.ts:65: `operator[0]` without length guard. Unhandled `TypeError` risk.

- **LOW** | SetupService.ts:35-38: Catch-all re-throw adds no value. Dead code.

- **MEDIUM** | SetupService.ts:25: `operatorCount` is array, not number. Misleading name.

- **MEDIUM** | SetupService.ts:63: User metadata no size validation. Storage abuse.

- **MEDIUM** | setup.ts:21: Operator `id` accepts any string. No format constraint.


### src/http/controllers/ProviderCatalogController.ts

- **LOW** | Line 240: Missing `default` case in switch. Silent `undefined` for new enum values.

- **LOW** | Lines 166-214: `req` unused across handlers.

- **LOW** | Lines 166/175/184/193/202/211: `async` never `await`.

- **MEDIUM** | Line 223: `let provider` implicitly `any`.


### src/http/controllers/AuditController.ts

- **LOW** | Line 41: OpenAPI missing 401 response.

- **LOW** | Line 62: No logging of audit log request.

- **MEDIUM** | Line 62: Service doesn't accept `RequestContext`. No service-layer permission enforcement.


### src/http/controllers/ChannelCatalogController.ts

- **HIGH** | Lines 75-84: No `checkPermissions()`. Inconsistent with security pattern.

- **HIGH** | Lines 82-83: Unknown type throws plain `Error`. 500 instead of 404.

- **MEDIUM** | Lines 77/83: Unnecessary Zod validation on trusted internal data.


### src/utils/idGenerator.ts


No issues found.

### src/utils/audioFormat.ts

- **LOW** | Line 23: `image/png` uses `startsWith`, should use `===`.

- **LOW** | Line 24: `image/jpeg` uses `startsWith`, could match `image/jp2`.


### src/utils/crypto.ts

- **LOW** | Line 49: Fixed hardcoded salt. Acceptable given password is security boundary.

- **LOW** | Line 72: Non-hex input falls through to base64 silently.


### src/utils/queryBuilder.ts

- **LOW** | Line 75: `in` operation with scalar produces SQL error.

- **LOW** | Lines 10/22: Uses `any` for parameter/return types.

- **LOW** | Lines 48-81: Repeated `as any` casts. Untyped `columnMap`.


### src/utils/deepMerge.ts


No issues found.

### src/utils/logger.ts

- **LOW** | Line 6: Transport configured at module load time. Doesn't adapt to `NODE_ENV` changes.

- **LOW** | Module-level singleton. Harder to pass child loggers with request context.


### src/utils/contextTruncation.ts


No issues found.

### src/utils/llmUsage.ts


No issues found.

### src/utils/costManagement.ts


No issues found.

### src/utils/env.ts

- **MEDIUM** | Line 7: Rejects `value > 0`, meaning `0` falls back to default. Should use `>= 0`.


### src/utils/permissions.ts


No issues found.

### src/utils/textSearch.ts

- **HIGH** | Line 36: Raw SQL interpolation of user input. Theoretical SQL injection.

- **LOW** | Line 31: Uses `any` for `Column<any>`.


### src/utils/validationRegistry.ts


No issues found.

### src/utils/actions.ts


No issues found.

### src/utils/llm.ts

- **LOW** | Lines 9/20/22: `as any` casts bypass type safety on `LlmContent`.


### src/utils/asyncHandler.ts


No issues found.

### src/utils/pagination.ts

- **LOW** | Line 26: `table` typed as `any`.


### src/utils/jsonParser.ts

- **LOW** | Lines 21-30: `split/slice/join` could be regex.

- **MEDIUM** | Line 11: Return type `unknown` but returns string.

- **MEDIUM** | Line 39: Blind `as string` cast before `JSON.parse`. No error handling.


### src/utils/wait.ts


No issues found.

### src/types/conversationEvents.ts


No issues found.

### src/types/actions.ts


No issues found.

### src/types/benchmark.ts


No issues found.

### src/types/models.ts


No issues found.

### src/types/classification.ts


No issues found.

### src/types/audio.ts


No issues found.

### src/types/parameters.ts


No issues found.

### src/types/TimeContext.ts


No issues found.

### src/types/callbacks.ts


No issues found.

### src/services/testing/ScenarioRunExecutorService.ts

- **LOW** | Lines 246-251: Busy-wait loop. Thundering herd risk.

- **LOW** | Lines 47-55: `context?.operatorId` — optional chaining on required param.

- **MEDIUM** | Line 56: `parseInt` without `NaN` guard. Unbounded concurrency risk.

- **MEDIUM** | Line 65: `setInterval` callback not async. Uncaught rejections can crash process.


### src/services/testing/ScenarioConversationEvaluator.ts

- **HIGH** | Lines 153-154: Control flow bug. `exists`/`not_exists` checked twice.

- **LOW** | Line 11: Hardcoded `comparisonModes` duplicates schema type.

- **LOW** | Line 186: `String(null)` false positive risk.

- **MEDIUM** | Line 136: `expected` accepts `null` but type says otherwise.

- **MEDIUM** | Line 194: `instanceof RegExp` always false for JSON/DB values. `matches` mode dead code.


### src/services/testing/ScenarioConversationService.ts

- **LOW** | Line 141: Misleading `ScenarioRunStatus` type for conversation status.

- **LOW** | Line 186: Redundant `.filter(Boolean)` after non-null assertion.


### src/services/testing/TesterClientConnection.ts

- **LOW** | Line 38: Resolves with `undefined` if `text` not set. Violates `Promise<string>`.


### src/services/testing/ScenarioService.ts

- **LOW** | Lines 40/52/152/188/230: `context?.operatorId` — optional chaining on required.

- **MEDIUM** | Line 165: `updatePayload: any`.


### src/services/testing/ScenarioRunService.ts

- **LOW** | Lines 41/49/195: `context?.operatorId` — optional chaining on required.

- **MEDIUM** | Line 165: `updatePayload: any`.


### src/services/testing/TesterService.ts

- **LOW** | Lines 40/47/151/183/225: `context?.operatorId` — optional chaining on required.

- **MEDIUM** | Line 164: `updatePayload: any`.


### src/services/testing/TestRunner.ts

- **HIGH** | Lines 62-64: Dynamic import + container resolve. Shared singleton risk for concurrent runs.

- **LOW** | Line 187: `null as never`.

- **LOW** | Lines 128-139: No timeout on LLM calls.

- **MEDIUM** | Lines 148-152: Fragile hang-up decision via string prefix.


### src/services/providers/ProviderCatalogService.ts

- **LOW** | Line 5: `extendZodWithOpenApi(z)` side-effect at module level.

- **LOW** | Lines 259-1148: Massive hardcoded data reconstructed every call.

- **MEDIUM** | Line 200: `channel` reuses `storageProviderInfoSchema`. Semantically wrong.


### src/services/providers/llm/LlmProviderBase.ts

- **HIGH** | Line 4: Unused import `log` from `handlebars`.

- **LOW** | Line 12: Redundant type annotation.

- **LOW** | Lines 92-140: All `notify*` unnecessarily `async`.

- **MEDIUM** | Line 181: "First message must be system" too rigid.

- **MEDIUM** | Lines 166-171: `applyDefaultOptions` discards options beyond `maxTokens`/`metadata`/`outputFormat`.


### src/services/providers/llm/LlmProviderFactory.ts

- **LOW** | Lines 100-145: Each case casts settings unsafely.

- **MEDIUM** | Line 68: `resolvedConfig as typeof provider.config` — unsafe cast.

- **MEDIUM** | Line 88: `{ model: '' } as LlmSettings` — unsafe cast.

- **MEDIUM** | Lines 97-152: Giant switch duplicates supported types list.


### src/services/providers/llm/ILlmProvider.ts

- **LOW** | Line 167: Redundant union of identical types.

- **LOW** | Line 45: `z.any()` too permissive.

- **LOW** | Lines 177-186: Commented-out dead code.


### src/services/providers/llm/OpenAILlmProvider.ts

- **HIGH** | Lines 96-113: `convertMessagesToInput` flattens to string. Loses structure/tool calls.

- **LOW** | Line 430: Regex-based model filtering brittle.

- **MEDIUM** | Line 449: Non-null assertion on `this.client`.

- **MEDIUM** | Line 5: `extendZodWithOpenApi(z)` duplicate.

- **MEDIUM** | Lines 202-206/280-289: `(item as any)` for Response API types.


### src/services/providers/llm/AnthropicLlmProvider.ts

- **LOW** | Line 5: `extendZodWithOpenApi(z)` duplicate.

- **LOW** | Lines 114-127: Image/audio methods throw from public `generate`.

- **MEDIUM** | Lines 148/225: `as any` bypasses type safety on API calls.

- **MEDIUM** | Lines 346-348: Tool role messages silently skipped.


### src/services/providers/llm/GeminiLlmProvider.ts

- **LOW** | Line 5: `extendZodWithOpenApi(z)` duplicate.

- **LOW** | Lines 489-538: Tool responses sent as user messages.

- **MEDIUM** | Lines 130/203/281/359: Four `as any` bypasses.

- **MEDIUM** | Lines 157/303: `Date.now()` ID collision risk.


### src/services/providers/llm/GroqLlmProvider.ts

- **LOW** | Line 42: Groq-specific settings lost in parent class.

- **LOW** | Line 5: `extendZodWithOpenApi(z)` duplicate.

- **MEDIUM** | Line 64: Coupling to parent class internal types.

- **MEDIUM** | Lines 77/148: `as any` for reasoning parameters.


### src/services/providers/llm/OllamaLlmProvider.ts

- **LOW** | Line 5: `extendZodWithOpenApi(z)` duplicate.

- **LOW** | Line 90: Returns empty array on failure.

- **MEDIUM** | Line 50: Unsafe intersection cast.


### src/services/providers/llm/CohereLlmProvider.ts

- **LOW** | Line 39: Unsafe `as OpenAILegacyLlmSettings` cast.

- **LOW** | Line 8: `extendZodWithOpenApi(z)` duplicate.


### src/services/providers/llm/DeepSeekLlmProvider.ts

- **LOW** | Line 39: Unsafe cast.

- **LOW** | Line 68: Fragile `includes('reasoner')` heuristic.

- **LOW** | Line 8: `extendZodWithOpenApi(z)` duplicate.


### src/services/providers/llm/FireworksAILlmProvider.ts

- **LOW** | Line 39: Unsafe cast.

- **LOW** | Line 8: `extendZodWithOpenApi(z)` duplicate.


### src/services/providers/llm/MistralLlmProvider.ts

- **LOW** | Line 10: `extendZodWithOpenApi(z)` duplicate.

- **LOW** | Line 303: `as any` for JSON data.

- **LOW** | Lines 188-193: Prefix-stripping logic flawed.

- **MEDIUM** | Line 272: Non-null assertion race condition.

- **MEDIUM** | Lines 99/320: `as any` bypasses type safety.


### src/services/providers/llm/OpenRouterLlmProvider.ts

- **LOW** | Line 41: Unsafe cast.

- **LOW** | Line 8: `extendZodWithOpenApi(z)` duplicate.


### src/services/providers/llm/PerplexityLlmProvider.ts

- **LOW** | Line 39: Unsafe cast.

- **LOW** | Line 8: `extendZodWithOpenApi(z)` duplicate.


### src/services/providers/llm/ScalewayLlmProvider.ts

- **LOW** | Line 39: Unsafe cast.

- **LOW** | Line 68: Fragile heuristic.

- **LOW** | Line 8: `extendZodWithOpenApi(z)` duplicate.


### src/services/providers/llm/TogetherAILlmProvider.ts

- **LOW** | Line 39: Unsafe cast.

- **LOW** | Line 8: `extendZodWithOpenApi(z)` duplicate.


### src/services/providers/llm/XAILlmProvider.ts

- **LOW** | Line 39: Unsafe cast.

- **LOW** | Line 68: Fragile heuristic.

- **LOW** | Line 8: `extendZodWithOpenApi(z)` duplicate.


### src/services/providers/llm/OVHLlmProvider.ts

- **LOW** | Line 39: Unsafe cast.

- **LOW** | Line 68: Fragile heuristic.

- **LOW** | Line 8: `extendZodWithOpenApi(z)` duplicate.


### src/services/providers/llm/OpenAILegacyLlmProvider.ts

- **LOW** | Line 10: `extendZodWithOpenApi(z)` duplicate.

- **LOW** | Line 199: `system_fingerprint` can be null.

- **LOW** | Line 314: Hardcoded regex fragile.

- **LOW** | Lines 171-177: JSON parsing fails on markdown-wrapped JSON.

- **MEDIUM** | Line 163: No guard against empty `choices`. `message` can be null.

- **MEDIUM** | Lines 128-141: Stub methods always throw. Dead code.

- **MEDIUM** | Lines 157-159/232-234: Commented-out dead code.


### src/services/providers/storage/IStorageProvider.ts


No issues found.

### src/services/providers/storage/StorageProviderBase.ts

- **LOW** | Lines 42-50: `onErrorCallback` fire-and-forget. Swallows original error.

- **MEDIUM** | Line 8: `config` optional but always set. Subclasses use `!`.


### src/services/providers/storage/S3StorageProvider.ts

- **LOW** | Line 175: `contentType` always undefined.

- **LOW** | Lines 190-195: Bare string concatenation for keys.

- **MEDIUM** | Line 78: Naive URL construction. Double slash risk.

- **MEDIUM** | Lines 48-56: No URL validation for endpoint.


### src/services/providers/storage/AzureBlobStorageProvider.ts

- **LOW** | Lines 34-37: `credential` should be `readonly`.

- **MEDIUM** | Lines 119-128: SAS token no IP/protocol restriction.

- **MEDIUM** | Lines 177-182: Bare concatenation. Double slash risk.


### src/services/providers/storage/GcsStorageProvider.ts

- **HIGH** | Line 44: Unvalidated `JSON.parse` of credentials.

- **LOW** | Line 34: `storage` should be `readonly`.

- **MEDIUM** | Lines 156-161: Bare concatenation.

- **MEDIUM** | Lines 63-68: `options.metadata` overwrite fragile.


### src/services/providers/storage/LocalStorageProvider.ts

- **HIGH** | Lines 102-116: In-memory token Map. Lost on restart. No bound. Memory leak.

- **HIGH** | Lines 196-200: Path traversal via `path.join`.

- **LOW** | Lines 217-220: Pretty-print adds unnecessary I/O.

- **MEDIUM** | Line 11: `extendZodWithOpenApi(z)` side-effect.

- **MEDIUM** | Lines 12-116: Token Map no eviction policy.


### src/services/providers/storage/StorageProviderFactory.ts

- **HIGH** | Lines 65/74/83/92: `settings as any`. Bypasses type system.

- **LOW** | Line 9: Unresolved TODO comment.

- **MEDIUM** | Line 33: `resolvedConfig` unsafe cast.


### src/services/providers/channel/TelegramChannelProvider.ts


No issues found.

### src/services/providers/channel/TwilioVoiceChannelProvider.ts


No issues found.

### src/services/providers/channel/WhatsAppChannelProvider.ts


No issues found.

### src/services/providers/channel/TwilioMessagingChannelProvider.ts


No issues found.

### src/channels/handlers/index.ts


No issues found.

### src/channels/websocket/contracts/aiResponse.ts


No issues found.

### src/channels/websocket/contracts/auth.ts


No issues found.

### src/channels/websocket/contracts/command.ts


No issues found.

### src/channels/websocket/contracts/common.ts


No issues found.

### src/channels/websocket/contracts/session.ts


No issues found.

### src/channels/websocket/contracts/userInput.ts


No issues found.

### src/channels/websocket/contracts/utils.ts

- **LOW** | Lines 15/31: `as any` on `.omit()`.


### src/services/providers/asr/AsrProviderBase.ts

- **LOW** | Line 188: `generateChunkId()` collision risk.

- **LOW** | Line 25: `onRecognitionStartedCallback` never cleared in `cleanup()`.

- **MEDIUM** | Line 11: `Record<string, any>` default generic.

- **MEDIUM** | Line 175: `handleError` async but callers don't await. Unhandled rejections.

- **MEDIUM** | Lines 138/151: Recognized text logged at debug/info. PII risk.


### src/services/providers/asr/AsrProviderFactory.ts

- **LOW** | Line 43: `providerType` check duplicated.

- **LOW** | Line 50: `resolvedConfig` unsafe cast.

- **LOW** | Lines 156-157: `supportedApiTypes` duplicates switch cases.

- **MEDIUM** | Line 41: Settings typed as `unknown` then blindly cast.


### src/services/providers/asr/IAsrProvider.ts


No issues found.

### src/services/providers/asr/AssemblyAiAsrProvider.ts

- **LOW** | Line 388-409: Close timeout leaves pending promise with listeners.

- **MEDIUM** | Line 261: `turn: any` untyped.

- **MEDIUM** | Line 352: `slice.buffer` access fragile.


### src/services/providers/asr/AzureAsrProvider.ts

- **LOW** | Line 298: `cleanup()` doesn't reset `audioFormat`/`chunkId`.

- **LOW** | Lines 171-198: Race condition on `audioStream`.

- **MEDIUM** | Line 258: ArrayBuffer write with redundant cast.

- **MEDIUM** | Line 44: British spelling `recognising`.

- **MEDIUM** | Lines 133-139: Event handlers re-assigned on every `start()`.


### src/services/providers/asr/DeepgramAsrProvider.ts

- **LOW** | Line 144: Unhandled rejection on late WebSocket error.

- **LOW** | Line 310: Missing `resetForNewTurn()` override.

- **MEDIUM** | Line 244: `JSON.parse` no error handling. Terminates on malformed message.

- **MEDIUM** | Lines 177-187: `stop()` returns before final transcripts.


### src/services/providers/asr/ElevenLabsAsrProvider.ts

- **HIGH** | Lines 142-158: `start()` hangs indefinitely if `session_started` never arrives.

- **HIGH** | Lines 317-327: `flushAudioBuffer` infinite loop risk on socket state mismatch.

- **LOW** | Missing `resetForNewTurn()` override.

- **MEDIUM** | Line 310: Logs `JSON.stringify(message)` for unknown types.

- **MEDIUM** | Lines 268-289: Transcript silently lost on config mismatch.


### src/services/providers/asr/SpeechmaticsAsrProvider.ts

- **HIGH** | Lines 340-350: `getAllTextChunks()` deviates from interface contract.

- **LOW** | Missing `cleanup()`. Resource leak.

- **LOW** | Missing `resetForNewTurn()` override.

- **MEDIUM** | Line 144: `transcriptionConfig: any`.

- **MEDIUM** | Line 247: `audio.buffer` access fragile.

- **MEDIUM** | Lines 355-365: After `EndOfTranscript`, audio buffers indefinitely.


### src/services/providers/tts/TtsProviderBase.ts

- **LOW** | Line 12: `TChunk` constraint creates type mismatch.

- **LOW** | Line 160: `generateChunkId()` collision risk.

- **MEDIUM** | Line 14: `chunkOrdinal` mutable shared state.


### src/services/providers/tts/TtsProviderFactory.ts

- **LOW** | Lines 175-185: Supported types duplicated three times.

- **MEDIUM** | Line 52: `resolvedConfig` unsafe cast.


### src/services/providers/tts/ITtsProvider.ts


No issues found.

### src/services/providers/tts/ElevenLabsTtsProvider.ts

- **HIGH** | Line 272: `.at(-1)` returns `undefined`. Addition produces `NaN`.

- **LOW** | Line 271: `Buffer.concat([...this.audioChunks])` O(n²) memory.

- **LOW** | Line 379: Fire-and-forget async callback.

- **MEDIUM** | Lines 139/262: `async` message handler without `.catch()`.


### src/services/providers/tts/OpenAiTtsProvider.ts

- **LOW** | Line 263: `requestBody: any`.

- **LOW** | Lines 354-411: `getFilterIndexes`/`cutText` duplicated.

- **MEDIUM** | Line 238: Request chain breaks on error. No `.catch()`.

- **MEDIUM** | Lines 278-289: Timeout not cleared in `finally`.


### src/services/providers/tts/CartesiaTtsProvider.ts

- **HIGH** | Line 210: API key in URL query parameter. Credential exposure.

- **LOW** | Line 576: Fire-and-forget async callback.

- **LOW** | Lines 645-702: `getFilterIndexes`/`cutText` duplicated.

- **MEDIUM** | Line 220: `async` message handler without `.catch()`.

- **MEDIUM** | Lines 475-487: Promise hangs indefinitely on socket drop.


### src/services/providers/tts/DeepgramTtsProvider.ts

- **LOW** | Lines 605-662: `getFilterIndexes`/`cutText` duplicated.

- **MEDIUM** | Line 298: `async` message handler without `.catch()`.

- **MEDIUM** | Line 470: Non-null assertion unsafe.

- **MEDIUM** | Lines 694-710: Connection race between `start()` and reconnect.


### src/services/providers/tts/AzureTtsProvider.ts

- **HIGH** | Line 440: Missing `cleanup()`. SDK resource leak.

- **LOW** | Lines 381-427: SSML injection via unescaped `voiceName`/`style`/`rate`/`pitch`.

- **MEDIUM** | Line 288: `handleError` throw skips `synthesizer.close()`.


### src/services/providers/tts/AmazonPollyTtsProvider.ts

- **LOW** | Line 426: `cleanup()` doesn't destroy HTTP connections.

- **LOW** | Lines 364-421: `getFilterIndexes`/`cutText` duplicated.

- **MEDIUM** | Lines 255-259: `as any` bypasses type checking.


### src/services/providers/tts/SentenceSplitter.ts

- **LOW** | Line 141: Stale index access.

- **MEDIUM** | Line 101: Failed sentence text silently dropped.

- **MEDIUM** | Line 118: Not exponential backoff.


### src/scripts/generateWebSocketSchemas.ts

- **LOW** | Line 157: Double serialization for string replacement.

- **LOW** | Line 157: String-replace `$ref` conversion fragile.


### src/scripts/migrateSecretsToEncrypted.ts

- **HIGH** | Lines 56-61: All plain-text secrets in memory simultaneously.

- **LOW** | Line 98: `console.error` instead of `logger.error`.

- **MEDIUM** | Lines 72-78: No transaction. Partial update on failure.

- **MEDIUM** | Lines 81-85: Same — no transaction for environment updates.

- **MEDIUM** | Lines 97-99: Executes on import. Double migration risk.


### src/scripts/fetch-azure-voices.ts

- **[DONE] CRITICAL** | Lines 18-19: Hard-coded credential placeholders checked in.

- **HIGH** | Lines 23-28: Validation passes on placeholder values. Confusing errors.

- **LOW** | Line 51: Unfiltered SDK response written to disk.

- **LOW** | Lines 37-43: `synthesizer.close()` not in error path.

- **MEDIUM** | Lines 54-55/88-93/98-102: `any` types.


### src/db/schema.ts

- **INFO** | Line 397: `serial('id')` on `issues` — only table with integer PK.

- **INFO** | Line 717: `stagesRelations` references wrong PK. Cross-project match risk.

- **LOW** | Line 128: `$type<Record<string, any>>()` on `projects.constants`.

- **LOW** | Line 40: `$type<Record<string, Record<string, any>>>()` on `stageVars`.

- **LOW** | Line 75: `$type<string[]>()` on `operators.roles`. No DB constraint.

- **MEDIUM** | Line 22: `$type<Record<string, any>>()` on `users.profile`. No validation.


### src/db/index.ts

- **HIGH** | Line 11: `ssl: { rejectUnauthorized: false }`. TLS verification disabled. MITM risk.

- **LOW** | Lines 29-31: Logs on every connection checkout. Spam under load.

- **LOW** | Lines 33-36: `pool.on('error')` calls `process.exit(1)`. No recovery.

- **MEDIUM** | Line 1: Module-level `Pool` creation. Multiple pools on re-import.

- **MEDIUM** | Lines 25-27: `SET TIME ZONE` on every connection checkout adds latency.


### src/db/migrate.ts

- **INFO** | Line 19: Hardcoded relative `migrationsFolder`.

- **LOW** | Lines 10-13: New `Pool` without `DB_POOL_SIZE` config.

- **MEDIUM** | Line 12: `ssl: { rejectUnauthorized: false }`. Same TLS bypass.

- **MEDIUM** | Line 15: `drizzle(pool)` with no schema.


### src/http/contracts/provider.ts

- **LOW** | Line 34: `extendZodWithOpenApi(z)` duplicate.

- **LOW** | Lines 178-179: `z.coerce.date()` produces `Invalid Date`.


### src/http/contracts/migration.ts

- **LOW** | Line 34: `extendZodWithOpenApi(z)` duplicate.

- **LOW** | Lines 115-131: Repeated transform across 18 fields.

- **MEDIUM** | Line 7: `z.any()` zero validation for migration imports.


### src/http/contracts/telegram.ts

- **LOW** | Line 14: `z.any()` for Telegram response.

- **MEDIUM** | Line 6: API key in POST body. No format validation.


### src/http/contracts/conversation.ts

- **LOW** | Line 34: `z.record(z.string(), z.unknown())` no validation.

- **LOW** | Line 5: Imports from internal types. Coupling.

- **LOW** | Lines 18/35/119/120/147: `z.coerce.date()` produces `Invalid Date`.


### src/http/contracts/project.ts

- **LOW** | Line 124: `z.record(z.string(), z.any())` no validation.

- **LOW** | Line 178: `z.coerce.date()` produces `Invalid Date`.

- **LOW** | Line 18: `extendZodWithOpenApi(z)` duplicate.

- **LOW** | Line 43: Double `.optional()` on `storageConfig`.


### src/http/contracts/benchmark.ts

- **LOW** | Line 6: `extendZodWithOpenApi(z)` duplicate.

- **LOW** | Lines 105-106/162-163: `z.coerce.date()` produces `Invalid Date`.

- **LOW** | Lines 132-133: `settings` vs `providerSettings` naming ambiguity.


### src/http/contracts/common.ts

- **LOW** | Line 27: `extendZodWithOpenApi(z)` duplicate.

- **LOW** | Lines 116-131: `.catchall(z.unknown())` accepts arbitrary fields.

- **MEDIUM** | Line 63: Negative values coerced, not rejected.


### src/http/contracts/vad.ts

- **LOW** | Line 4: `extendZodWithOpenApi(z)` duplicate.


### src/http/contracts/sliceAnalytics.ts

- **LOW** | Lines 64-65: `z.coerce.date()` produces `Invalid Date`.

- **MEDIUM** | Lines 73-86: Manual `SliceQuery` type diverges from schema.


### src/http/contracts/projectExchange.ts

- **LOW** | Line 216: `.default()` inside `z.object()` ignored by discriminated union.

- **LOW** | Line 56: `z.record(z.string(), z.unknown())` no validation.

- **LOW** | Line 9: `extendZodWithOpenApi(z)` duplicate.


### src/http/contracts/scenario.ts

- **LOW** | Line 9: `extendZodWithOpenApi(z)` duplicate.


### src/http/contracts/tester.ts

- **LOW** | Line 9: `extendZodWithOpenApi(z)` duplicate.

- **MEDIUM** | Lines 28/44: `llmSettingsSchema.unwrap().unwrap()` fragile.


### src/http/contracts/secret.ts


No issues found.

### src/http/contracts/operator.ts

- **LOW** | Line 12: `Object.keys(ROLES) as [string, ...string[]]` unsafe cast.

- **LOW** | Line 9: `extendZodWithOpenApi(z)` duplicate.


### src/http/contracts/tool.ts

- **HIGH** | Line 123: `z.url()` not valid Zod. Should be `z.string().url()`. Runtime crash.

- **LOW** | Line 9: `extendZodWithOpenApi(z)` duplicate.


### src/http/contracts/auth.ts


No issues found.

### src/http/contracts/costManagement.ts


No issues found.

### src/http/contracts/analytics.ts


No issues found.

### src/http/contracts/apiKey.ts

- **LOW** | Line 43: Missing `.int()` on version.

- **LOW** | Lines 29/40/70: `z.record(z.string(), z.any())` should be `z.unknown()`.


### src/http/contracts/user.ts


No issues found.

### src/http/contracts/stage.ts

- **LOW** | Line 9: `extendZodWithOpenApi(z)` duplicate.

- **MEDIUM** | Lines 123/147: `llmSettingsSchema.unwrap().unwrap()` fragile.


### src/http/contracts/globalAction.ts

- **LOW** | Line 9: `extendZodWithOpenApi(z)` duplicate.


### src/http/contracts/guardrail.ts

- **LOW** | Line 9: `extendZodWithOpenApi(z)` duplicate.


### src/http/contracts/version.ts


No issues found.

### src/http/contracts/audit.ts


No issues found.

### src/http/contracts/classifier.ts

- **LOW** | Line 9: `extendZodWithOpenApi(z)` duplicate.

- **MEDIUM** | Lines 29/43: `llmSettingsSchema.unwrap().unwrap()` fragile.


### src/http/contracts/knowledge.ts


No issues found.

### src/http/contracts/setup.ts


No issues found.

### src/http/contracts/providerCatalog.ts

- **LOW** | Line 9: `extendZodWithOpenApi(z)` duplicate.


### src/http/contracts/environment.ts

- **LOW** | Line 9: `extendZodWithOpenApi(z)` duplicate.


### src/http/contracts/contextTransformer.ts

- **LOW** | Line 9: `extendZodWithOpenApi(z)` duplicate.

- **MEDIUM** | Lines 30/45: `llmSettingsSchema.unwrap().unwrap()` fragile.


### src/http/contracts/issue.ts


No issues found.

### src/http/contracts/scenarioRun.ts


No issues found.

### src/http/contracts/scenarioConversation.ts


No issues found.

### src/http/contracts/savedSliceQuery.ts


No issues found.

### src/http/contracts/copyDecorator.ts


No issues found.

### src/http/contracts/sampleCopy.ts

- **LOW** | Line 9: `extendZodWithOpenApi(z)` duplicate.

- **MEDIUM** | Lines 11-14: Type aliases never used. Dead code.


### src/http/contracts/channelCatalog.ts


No issues found.

### src/http/contracts/funnels.ts

- **LOW** | Line 9: `extendZodWithOpenApi(z)` duplicate.

- **MEDIUM** | Line 53: `steps` no `.min(2)`.

- **MEDIUM** | Lines 53-58: `relativeTime` and `from`/`to` not mutually exclusive.


### src/http/contracts/twilio-voice-outgoing.ts


No issues found.

### src/http/contracts/twilio-messaging-outgoing.ts


No issues found.

### src/http/contracts/whatsapp-outgoing.ts


No issues found.

### src/http/contracts/agent.ts

- **LOW** | Line 4: Unused import `audioFormatValues`.

- **LOW** | Line 9: `extendZodWithOpenApi(z)` duplicate.

- **LOW** | Lines 16-20: Duplicate JSDoc comments.


### src/services/benchmarking/LlmBenchmarkRunner.ts

- **LOW** | Line 48: Unnecessary `Promise.resolve()`.

- **MEDIUM** | Line 54: `(c: any)` unnecessary cast.

- **MEDIUM** | Lines 34-36: `factory.createProvider()` not awaited.

- **MEDIUM** | Lines 37-67: No guard against double-settling promise.


### src/services/benchmarking/AsrBenchmarkRunner.ts

- **LOW** | Line 40: Logs raw Error object.

- **LOW** | Line 71: `Buffer.from` silent partial data on malformed base64.

- **MEDIUM** | Lines 45-48: `setOnRecognitionStopped` no settled guard.

- **MEDIUM** | Lines 82/107: `completedAt` declared in two scopes.


### src/services/benchmarking/TtsBenchmarkRunner.ts

- **LOW** | Line 75: Inconsistent precision across runners.

- **LOW** | Lines 37/41/53: Async callbacks with no await.

- **MEDIUM** | Lines 36-61: No guard against double-settling promise.


### src/services/audio/VadProcessor.ts

- **LOW** | Line 102: No bounds check on `mode` index.

- **LOW** | Line 54: `Buffer.allocUnsafe` not needed.

- **MEDIUM** | Line 169: VAD errors silently swallowed.


### src/services/audio/AudioConverterFactory.ts

- **LOW** | Line 2: Static import cost for non-ffmpeg tiers.


### src/services/audio/FfmpegAudioConverter.ts

- **LOW** | Line 68: Excessive log volume on corrupt input.

- **MEDIUM** | Line 78: Reentrant `spawnProcess()` race condition.


### src/services/audio/speexResampler.ts

- **LOW** | Line 8: `as any` ESM/CJS workaround.


### src/services/audio/OpusFrameAligner.ts


No issues found.

### src/services/audio/G711Converter.ts

- **LOW** | Line 54: Private constructor with `any` resampler.

- **MEDIUM** | Line 71: `resampler: any`. No compile-time safety.


### src/services/audio/OpusConverter.ts

- **LOW** | Line 49: Misleading class name for decode path.

- **MEDIUM** | Lines 31-33: `encoder/decoder/resampler: any`.


### src/services/audio/opusEncoder.ts

- **LOW** | Lines 8-9: `as any` ESM/CJS workaround.


### src/services/audio/SpeexPcmResampler.ts


No issues found.

### src/services/audio/IAudioConverter.ts


No issues found.

### src/services/audio/AudioFormatUtils.ts

- **LOW** | Lines 54-76: Unknown formats return empty array.

- **MEDIUM** | Lines 42-48: No exhaustiveness check. New formats silently degrade.


### src/services/secrets/ISecretsManager.ts

- **LOW** | Line 1: `InjectionToken` import only for dead code.

- **LOW** | Line 38: Misleading token name.

- **LOW** | Line 38: `ISecretsManagerRegistryToken` dead code.


### src/services/secrets/SecretsManagerRegistry.ts

- **LOW** | Lines 23-26: `register` silently overwrites.

- **LOW** | Lines 41-44: `storeSecret` no empty string rejection.

- **LOW** | Lines 72-81: One failing manager aborts entire list.

- **MEDIUM** | Lines 103-106: `parseRef` no validation.

- **MEDIUM** | Lines 52-56: `resolveSecret` no input validation.

- **MEDIUM** | Lines 63-67: `deleteSecret` no input validation.


### src/services/secrets/LocalSecretsManager.ts

- **LOW** | Lines 37-43: `storeSecret` no deduplication. Orphaned secrets.

- **LOW** | Lines 86-88: `extractId` no format validation.

- **MEDIUM** | Lines 24-30: Constructor throws if key missing. App crash risk.


### src/services/secrets/SecretRefUtils.ts

- **LOW** | Line 43: Skips null/undefined silently.

- **LOW** | Line 8: Hardcoded sensitive fields. No extension mechanism.

- **MEDIUM** | Line 38: `secretizeObject` only processes top-level. Nested values in plaintext.


### src/services/analytics/AnalyticsService.ts

- **HIGH** | Line 301: `ue` alias referenced without LATERAL join. Column-not-found error.

- **MEDIUM** | Line 298: `stage_id` vs `starting_stage_id`. Silent no-match.

- **MEDIUM** | Line 488: Same `stage_id` vs `starting_stage_id`.


### src/services/analytics/FunnelQueryService.ts

- **LOW** | Lines 52-65: All user IDs in memory. High memory for large sets.

- **MEDIUM** | Line 147: Assumes `result` is JSON array. Silent NULL.

- **MEDIUM** | Line 177: `parseInt` can produce `NaN`. SQL error.


### src/services/analytics/SliceQueryBuilder.ts

- **HIGH** | Line 257: `c.project_id = c.project_id` always true. Cross-project data leak.

- **LOW** | Line 303: Redundant `1=1` condition.

- **MEDIUM** | Lines 346-352: Unbounded IN clause.


### src/services/analytics/SliceAnalyticsService.ts

- **LOW** | Lines 112-130: O(rows × dimensions) processing.

- **MEDIUM** | Lines 81-83: `resolveRelativeTime` spread fragile.


### src/services/analytics/SavedFunnelQueryService.ts

- **LOW** | Line 167: `findVisible` returns `any`.

- **LOW** | Line 68: `input.query as Record<string, any>`.


### src/services/analytics/SavedSliceQueryService.ts

- **LOW** | Line 177: `findVisible` returns `any`.

- **LOW** | Line 67: `input.query as Record<string, any>`.

- **LOW** | Lines 167-170: Expected errors logged as failures.


### src/services/analytics/sources.ts


No issues found.

### src/services/StageService.ts

- **INFO** | Lines 104/128/203/275/314/341: Repeated catch-rethrow pattern.

- **LOW** | Line 243: `updatePayload: any`.

- **LOW** | Line 340: Multiple `as any` casts.

- **LOW** | Line 353: Returns `any[]`.

- **MEDIUM** | Line 165: `filter as string[]` unsafe cast.

- **MEDIUM** | Line 96: 100+ columns in single line. Unmaintainable.

- **MEDIUM** | Lines 116-131: Catches expected `NotFoundError`. Noise in logs.

- **MEDIUM** | Lines 90/100/222/270/292/331: `context?.operatorId` on required param.


