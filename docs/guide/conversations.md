# Conversations

A **Conversation** represents a real-time session between an end user and the AI. Conversations track state, variables, events, and artifacts throughout their lifecycle.

## Structure

| Field | Description |
|---|---|
| `id` | Conversation identifier |
| `projectId` | Parent project |
| `userId` | End user ID |
| `clientId` | Client application identifier |
| `stageId` | Current stage the conversation is in |
| `stageVars` | Stage variables (map of stage ID → variables) |
| `status` | Current conversation state |
| `statusDetails` | Optional reason for the current status |
| `metadata` | Arbitrary JSON |

## Conversation States

Conversations follow this state machine:

```
initialized
    │
    ▼
awaiting_user_input ◄──────────────┐
    │                                │
    ▼                                │
receiving_user_voice                 │
    │                                │
    ▼                                │
processing_user_input                │
    │                                │
    ▼                                │
generating_response ────────────────┘
    │
    ├───► finished       (graceful end)
    ├───► aborted        (immediate end)
    └───► failed         (error)
```

| State | Description |
|---|---|
| `initialized` | Conversation created but not yet started |
| `awaiting_user_input` | Waiting for user to speak or type |
| `receiving_user_voice` | User is actively streaming voice audio |
| `processing_user_input` | Classifying and processing user input |
| `generating_response` | LLM is generating a response |
| `finished` | Conversation ended gracefully |
| `aborted` | Conversation ended abruptly |
| `failed` | Conversation ended due to an error |

## Conversation Events

Every significant occurrence during a conversation is recorded as an event:

| Event Type | Description |
|---|---|
| `conversation_start` | Conversation started (stageId, initial variables) |
| `conversation_resume` | Conversation resumed from a previous session |
| `conversation_end` | Conversation ended gracefully (reason, stageId) |
| `conversation_aborted` | Conversation aborted (reason, stageId) |
| `conversation_failed` | Conversation failed (reason, stageId) |
| `message` | User or AI message (role, text, original text, LLM usage) |
| `classification` | Classifier result (classifierId, matched actions, parameters) |
| `transformation` | Transformer result (transformerId, applied fields) |
| `action` | Action executed (action name, stageId, effects) |
| `command` | Client command received (command type, parameters) |
| `tool_call` | Tool invoked (toolId, parameters, result, success/error) |
| `jump_to_stage` | Stage navigation (fromStageId, toStageId) |

Events provide a full audit trail of the conversation for debugging, analytics, and compliance.

## Conversation Artifacts

Artifacts are binary or text data associated with a conversation:

| Artifact Type | Description |
|---|---|
| `user_voice` | User's voice audio recording |
| `user_transcript` | User's speech transcription |
| `ai_voice` | AI's voice audio output |
| `ai_transcript` | AI's generated text |
| `tool_input` | Input sent to a tool |
| `tool_output` | Output received from a tool |
| `other` | Any other artifact |

Artifacts can be stored inline (base64), in external storage (S3, Azure Blob, GCS), or both, depending on the project's `storageConfig`.

## Stage Variables

Conversations maintain variables scoped to each stage. The `stageVars` field is a nested map:

```json
{
  "greeting-stage": {
    "customerName": "Alice",
    "tier": "premium"
  },
  "troubleshooting-stage": {
    "issueType": "billing",
    "resolved": false
  }
}
```

When navigating between stages, each stage's variables are preserved separately, so returning to a previous stage restores its state.

## Lifecycle

1. **Start** — Client sends `start_conversation` with `userId` and starting `stageId`
2. **Input loop** — User sends voice or text, system processes and responds
3. **Stage navigation** — Conversation moves between stages via `go_to_stage` effects
4. **Resume** — A previously started conversation can be resumed with `resume_conversation`
5. **End** — Conversation ends via:
   - `end_conversation` effect (graceful)
   - `abort_conversation` effect (immediate)
   - Client disconnect
   - Error (failed state)

See [WebSocket Protocol](./websocket) for the complete message flow.
