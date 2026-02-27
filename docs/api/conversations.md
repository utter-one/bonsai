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

---

## Conversation Response

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `id` | `string` | No | Unique identifier |
| `projectId` | `string` | No | Parent project ID |
| `userId` | `string` | No | User associated with this conversation |
| `clientId` | `string` | No | Client identifier |
| `stageId` | `string` | No | Current stage identifier |
| `stageVars` | `Record<string, Record<string, unknown>>` | Yes | Variables stored per stage |
| `status` | `string` | No | Status: `initialized`, `awaiting_user_input`, `receiving_user_voice`, `processing_user_input`, `generating_response`, `finished`, `aborted`, or `failed` |
| `statusDetails` | `string` | Yes | Details about the current status |
| `metadata` | `object` | Yes | Additional metadata |
| `createdAt` | `string` | No | ISO 8601 creation timestamp |
| `updatedAt` | `string` | No | ISO 8601 last update timestamp |

## Event Response

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `id` | `string` | No | Unique event identifier |
| `projectId` | `string` | No | Project ID |
| `conversationId` | `string` | No | Parent conversation ID |
| `eventType` | `string` | No | Event type (see below) |
| `eventData` | `object` | No | Event data payload |
| `timestamp` | `string` | No | ISO 8601 event timestamp |
| `metadata` | `object` | Yes | Additional metadata |

### Event Types

| Type | Description |
|------|-------------|
| `message` | User or assistant message |
| `classification` | Intent classification result |
| `transformation` | Context transformation applied |
| `action` | Action triggered |
| `command` | Client command executed |
| `tool_call` | Tool invocation |
| `conversation_start` | Conversation started |
| `conversation_resume` | Conversation resumed |
| `conversation_end` | Conversation ended normally |
| `conversation_aborted` | Conversation aborted |
| `conversation_failed` | Conversation failed |
| `jump_to_stage` | Stage transition occurred |
