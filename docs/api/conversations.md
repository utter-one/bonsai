# Conversations

Conversations represent active or completed conversational AI sessions. They are created through the WebSocket API and can be viewed and managed through the REST API.

**Tag:** `Conversations` | **Scoped to:** Project

For more information, see the [Conversations](../guide/conversations) guide.

::: info
Conversations are created internally through the WebSocket session protocol. The REST API provides read and delete access only.
:::

## Get Conversation

```http
GET /api/projects/:projectId/conversations/:id
```

**Required permission:** `conversation:read`

**Response** `200 OK` — [Conversation Response](#conversation-response)

**Errors:** `404` Not found

## List Conversations

```http
GET /api/projects/:projectId/conversations
```

**Required permission:** `conversation:read`

Supports [pagination & filtering](./pagination).

## Delete Conversation

```http
DELETE /api/projects/:projectId/conversations/:id
```

**Required permission:** `conversation:delete`

**Response** `204 No Content`

**Errors:** `404` Not found

## List Conversation Events

```http
GET /api/projects/:projectId/conversations/:id/events
```

**Required permission:** `conversation:read`

Returns all events for a conversation, ordered chronologically.

Supports [pagination & filtering](./pagination).

**Response** `200 OK` — Paginated list of [Event Response](#event-response)

## Get Event by ID

```http
GET /api/projects/:projectId/conversations/:id/events/:eventId
```

**Required permission:** `conversation:read`

**Response** `200 OK` — [Event Response](#event-response)

**Errors:** `404` Not found

## Get Audit Logs

```http
GET /api/projects/:projectId/conversations/:id/audit-logs
```

**Required permission:** `audit:read`

Returns audit log entries for the specified conversation. See [Audit Logs](./audit-logs) for response format.

## List Conversation Artifacts

```http
GET /api/projects/:projectId/conversations/:id/artifacts
```

**Required permission:** `conversation:read`

Returns a paginated list of artifacts (voice recordings, transcripts, tool I/O) for the conversation.

**Query Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `type` | `string` | Filter by artifact type: `user_voice`, `user_transcript`, `ai_voice`, `ai_transcript`, `tool_input`, `tool_output`, `other` |

Supports [pagination & filtering](./pagination).

**Response** `200 OK` — Paginated list of [Artifact Response](#artifact-response)

## Get Conversation Artifact

```http
GET /api/projects/:projectId/conversations/:id/artifacts/:artifactId
```

**Required permission:** `conversation:read`

**Response** `200 OK` — [Artifact Response](#artifact-response)

**Errors:** `404` Not found

## Download Conversation Artifact

```http
GET /api/projects/:projectId/conversations/:id/artifacts/:artifactId/download
```

**Required permission:** `conversation:read`

Downloads the binary data for the artifact. Response `Content-Type` matches the artifact MIME type.

**Response** `200 OK` — Binary artifact data

**Errors:** `404` Not found

---

## Conversation Response

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `id` | `string` | No | Unique identifier |
| `projectId` | `string` | No | Parent project ID |
| `userId` | `string` | No | User associated with this conversation |
| `sessionId` | `string` | No | WebSocket session that initiated this conversation |
| `stageId` | `string` | No | Current stage identifier |
| `startingStageId` | `string` | Yes | Stage identifier at the start of the conversation |
| `endingStageId` | `string` | Yes | Stage identifier when the conversation reached a terminal state |
| `stageVars` | `Record<string, Record<string, unknown>>` | Yes | Variables stored per stage |
| `status` | `string` | No | Status: `initialized`, `awaiting_user_input`, `receiving_user_voice`, `processing_user_input`, `generating_response`, `finished`, `aborted`, or `failed` |
| `statusDetails` | `string` | Yes | Details about the current status |
| `direction` | `string` | No | Direction: `incoming` (user-initiated) or `outgoing` (Bonsai-initiated) |
| `metadata` | `object` | Yes | Additional metadata |
| `createdAt` | `string` | No | ISO 8601 creation timestamp |
| `updatedAt` | `string` | No | ISO 8601 last update timestamp |
| `archived` | `boolean` | Yes | Whether this entity belongs to an archived project |
| `artifacts` | `ArtifactSummary[]` | Yes | Summary of artifacts associated with this conversation |

## Event Response

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `id` | `string` | No | Unique event identifier |
| `projectId` | `string` | No | Project ID |
| `conversationId` | `string` | No | Parent conversation ID |
| `eventType` | `string` | No | Event type (see below) |
| `eventData` | `object` | No | Event data payload |
| `stageId` | `string` | Yes | Stage that was active when the event occurred |
| `timestamp` | `string` | No | ISO 8601 event timestamp |
| `metadata` | `object` | Yes | Additional metadata |

### Event Types

| Type | Description |
|------|-------------|
| `message` | User or assistant message |
| `classification` | Intent classification result |
| `transformation` | Context transformation applied |
| `execution_plan` | Action execution plan (priority-sorted, conflict-resolved effects) |
| `action` | *(Deprecated)* Use `execution_plan` instead |
| `command` | Client command executed |
| `tool_call` | Tool invocation |
| `conversation_start` | Conversation started |
| `conversation_resume` | Conversation resumed |
| `conversation_end` | Conversation ended normally |
| `conversation_aborted` | Conversation aborted |
| `conversation_failed` | Conversation failed |
| `jump_to_stage` | Stage transition occurred |
| `moderation` | Content moderation check result |
| `variables_updated` | Conversation variables modified by an action |
| `user_profile_updated` | User profile modified by an action |
| `user_input_modified` | User input transformed by an action |
| `user_banned` | User banned by an action |
| `visibility_changed` | Message visibility changed by an action |
| `sample_copy_selection` | Sample copy selected for the current turn |
| `turn_aborted` | AI generation turn aborted (e.g., barge-in) |

### Event Metadata — Timing Fields

The `metadata` object of certain events carries timing measurements (all durations in milliseconds).

#### `message` event — user role

| Field | Type | Description |
|-------|------|-------------|
| `source` | `"voice"` \| `"text"` | Input modality |
| `processingDurationMs` | `number` | Wall-clock time from turn start to LLM invocation (classification + transformation) |
| `actionsDurationMs` | `number` | Time spent executing actions triggered during input processing |
| `fillerDurationMs` | `number` \| `null` | Time spent generating the filler sentence, or `null` if no filler was used |

#### `message` event — assistant role

| Field | Type | Description |
|-------|------|-------------|
| `llmDurationMs` | `number` | Time from first LLM token to generation completion |
| `timeToFirstTokenMs` | `number` | Time from LLM invocation to the first token received |
| `timeToFirstTokenFromTurnStartMs` | `number` | Time from turn start to the first LLM token |
| `timeToFirstAudioMs` | `number` \| `null` | Time from turn start to the first TTS audio chunk (voice turns only; `null` for text turns) |
| `totalTurnDurationMs` | `number` \| `null` | Full turn duration from turn start to TTS completion. For voice turns this is **back-filled** after TTS finishes; for text turns it is set at LLM completion. |

#### `classification` event

| Field | Type | Description |
|-------|------|-------------|
| `durationMs` | `number` | Time taken to run the classifier |

#### `transformation` event

| Field | Type | Description |
|-------|------|-------------|
| `durationMs` | `number` | Time taken to run the context transformer |

#### `tool_call` event

The `eventData` object for a `tool_call` event has these fields:

| Field | Type | Description |
|-------|------|-------------|
| `toolId` | `string` | ID of the tool that was invoked |
| `toolName` | `string` | Display name of the tool |
| `toolType` | `string` | Tool type: `smart_function`, `webhook`, or `script` |
| `parameters` | `object` | Resolved parameters passed to the tool |
| `success` | `boolean` | Whether the tool executed successfully |
| `result` | `any` | Tool output (shape depends on tool type) |
| `error` | `string` | Error message if `success` is `false` |
| `sourceActionName` | `string` | Name of the action that triggered this tool call (if applicable) |

The `metadata` object carries:

| Field | Type | Description |
|-------|------|-------------|
| `durationMs` | `number` | Time taken to execute the tool |

## Artifact Response

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `id` | `string` | No | Unique identifier |
| `artifactType` | `string` | No | Artifact type: `user_voice`, `user_transcript`, `ai_voice`, `ai_transcript`, `tool_input`, `tool_output`, `other` |
| `storageKey` | `string` | Yes | Storage key in the storage provider |
| `storageUrl` | `string` | Yes | URL of the artifact in storage |
| `mimeType` | `string` | No | MIME type of the artifact |
| `fileSize` | `number` | No | Size of the artifact in bytes |
| `metadata` | `object` | Yes | Additional metadata |
| `createdAt` | `string` | No | ISO 8601 creation timestamp |
