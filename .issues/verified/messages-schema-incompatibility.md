---
title: "messages.ts schema inconsistencies and JSON incompatibility"
severity: high
status: resolved
created: 2026-05-29
updated: 2026-05-31
assignee: ""
tags: [type-safety, serialization, websocket]
---

# messages.ts schema inconsistencies and JSON incompatibility

## Description

Multiple HIGH issues in `messages.ts`:

1. **Line 251**: `calSetVarResponseSchema` uses `type: 'set_var_result'` while request uses `type: 'set_var'`. Inconsistency can break client-side message correlation.
2. **Lines 317, 389, 400**: `z.instanceof(Buffer)` makes schema incompatible with JSON serialization.

## Resolution

Reopened on 2026-05-31. Both claims investigated:

1. **`set_var` type naming — NOT AN ISSUE.** Both `calSetVarRequestSchema` (line 107) and `calSetVarResponseSchema` (line 251) use `type: z.literal('set_var')`. All request/response pairs share the same discriminator because they live in separate discriminated unions (`calInputMessageSchema` vs `calOutputMessageSchema`). No inconsistency exists.

2. **`z.instanceof(Buffer)` — VALID BUT CONTAINED.** Three CAL output schemas use `z.instanceof(Buffer)` for binary data: `calSendAiVoiceChunkMessageSchema.audioData`, `calSendAiImageOutputMessageSchema.imageData`, and `calSendAiAudioOutputMessageSchema.audioData`. This is intentional per the CAL design — the CAL layer uses raw Buffers, and each transport adapter converts to its wire format. The WebSocket layer in `src/channels/websocket/contracts/aiResponse.ts` overrides these fields with `z.string()` (base64). The JSON schema generator only registers WebSocket schemas, so `z.instanceof(Buffer)` never leaks into the generated JSON schema.

**Remaining risk**: Any code that JSON-serializes a CAL message with a Buffer (e.g., logging, tests, or a new channel adapter that doesn't convert) will silently lose data or throw. This is a known architectural constraint documented in the file header.

## Steps to Reproduce

1. Attempt to JSON-serialize a message with Buffer field
2. Observe serialization failure or data loss

## Expected Behavior

Schemas should be JSON-compatible. Response type discriminators should be consistent.

## Actual Behavior

Buffer schemas break JSON serialization. Inconsistent type naming.

## Notes

File: `src/channels/messages.ts`
