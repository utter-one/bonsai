# Deferred Processing

REST API for observing and controlling the deferred processing queue. All endpoints are project-scoped.

**Tag:** `Deferred Processing`

For conceptual details, see [Deferred Processing](../guide/deferred-processing).

## List Deferred Processing Entries

```http
GET /api/projects/:projectId/deferred-processing
```

**Required permission:** `project:read`

Lists deferred processing queue entries for a project. Supports filtering by status, conversation, and channel type.

**Query Parameters**

| Field | Type | Default | Description |
|---|---|---|---|
| `offset` | `number` | `0` | Starting index for pagination |
| `limit` | `number` (1–100) | `50` | Maximum number of items to return |
| `status` | `string` | — | Filter by status: `pending`, `processed`, `failed`, `cancelled` |
| `conversationId` | `string` | — | Filter by conversation ID |
| `channelType` | `string` | — | Filter by channel type |

**Response** `200 OK`

```json
{
  "items": [
    {
      "id": "uuid",
      "sessionId": "session_abc123",
      "providerId": "uuid",
      "projectId": "uuid",
      "conversationId": "uuid",
      "channelType": "smtp_imap",
      "processAt": "2025-01-15T10:30:00Z",
      "message": { "type": "send_user_text_input", "conversationId": "uuid", "text": "Hello" },
      "status": "pending",
      "retryCount": 0,
      "lastError": null,
      "createdAt": "2025-01-15T10:29:45Z",
      "updatedAt": "2025-01-15T10:29:45Z",
      "processedAt": null
    }
  ],
  "total": 1,
  "offset": 0,
  "limit": 50
}
```

## Get Deferred Processing Entry

```http
GET /api/projects/:projectId/deferred-processing/:id
```

**Required permission:** `project:read`

Retrieves a single deferred processing entry by ID. Returns `404` if the entry does not exist or does not belong to the project.

**Response** `200 OK` — [Deferred Processing Entry](#deferred-processing-entry)

**Errors:** `404` Entry not found

## Reschedule Deferred Processing Entry

```http
POST /api/projects/:projectId/deferred-processing/:id/reschedule
Content-Type: application/json
```

**Required permission:** `project:write`

Changes the scheduled processing time for a pending entry. Use a past date to trigger immediate processing (next poll cycle, ~15 seconds). Maximum future delay is 30 days from now.

**Request Body**

| Field | Type | Required | Description |
|---|---|---|---|
| `processAt` | `date` (ISO 8601) | Yes | New scheduled processing time |

**Response** `200 OK` — [Deferred Processing Entry](#deferred-processing-entry)

**Errors:** `404` Entry not found or not pending

## Cancel Deferred Processing Entry

```http
POST /api/projects/:projectId/deferred-processing/:id/cancel
Content-Type: application/json
```

**Required permission:** `project:write`

Cancels a pending deferred processing entry. The message will not be processed.

**Response** `200 OK` — [Deferred Processing Entry](#deferred-processing-entry)

**Errors:** `404` Entry not found or not pending

---

## Deferred Processing Entry

| Field | Type | Nullable | Description |
|---|---|---|---|
| `id` | `string` | No | Unique identifier |
| `sessionId` | `string` | No | Session ID associated with this entry |
| `providerId` | `string` | No | Channel provider ID that received the original message |
| `projectId` | `string` | No | Project ID this entry belongs to |
| `conversationId` | `string` | Yes | Conversation ID if the message was for an existing conversation |
| `channelType` | `string` | No | Channel type (`smtp_imap`, `sendgrid`, `ses`, `twilio_messaging`, `whatsapp`, `telegram`) |
| `processAt` | `date` | No | Scheduled processing time |
| `message` | `object` | No | The original CAL input message that was queued |
| `status` | `string` | No | Current status: `pending`, `processed`, `failed`, `cancelled` |
| `retryCount` | `number` | No | Number of retry attempts so far |
| `lastError` | `string` | Yes | Error message from the last failed attempt |
| `createdAt` | `date` | No | Timestamp when the entry was created |
| `updatedAt` | `date` | No | Timestamp when the entry was last updated |
| `processedAt` | `date` | Yes | Timestamp when the entry was successfully processed |
