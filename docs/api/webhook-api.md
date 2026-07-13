# Bonsai Webhook Tool API Reference

Complete reference for the webhook tool call flow and deferred reply endpoint.

---

# Table of Contents

1. [Overview](#overview)
2. [Webhook Outbound Call](#webhook-outbound-call)
3. [Response Code Contract](#response-code-contract)
4. [Reply Endpoint](#reply-endpoint)
5. [Reply Effects](#reply-effects)
6. [WebSocket Events](#websocket-events)
7. [Error Handling](#error-handling)
8. [Examples](#examples)

---

# Overview

Bonsai webhook tools make HTTP requests to external services during conversation execution. There are two modes:

| Mode | Configuration | Behavior |
|---|---|---|
| **Instant** | `asyncReply` not set or `asyncReply.enabled: false` | Bonsai waits for the response inline. The external service must respond with HTTP 200. |
| **Deferred** | `asyncReply.enabled: true` | Bonsai expects HTTP 202, then the external service replies later via the reply endpoint. The conversation does not block. |

## Async Reply Configuration

When creating or updating a webhook tool, the `asyncReply` field controls deferred mode:

```json
{
  "asyncReply": {
    "enabled": true,
    "timeoutMs": 300000,
    "secret": "your-secret-key"
  }
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | — | Enable deferred reply mode |
| `timeoutMs` | `number` | `300000` (5 min) | Maximum wait time for reply (1000–600000 ms) |
| `secret` | `string` | — | Secret for authenticating replies. External service must echo this in the `x-bonsai-reply-secret` header. |

---

# Webhook Outbound Call

When Bonsai executes a webhook tool, it makes an HTTP request to the configured URL.

## Request Format

- **Method**: Configurable (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`). Default: `GET`.
- **URL**: Rendered through Handlebars templating with conversation context.
- **Body**: For `POST`/`PUT`/`PATCH`, the `webhookBody` template is rendered and sent as the request body.
- **Content-Type**: Always `application/json`.

## Injected Headers

Bonsai always injects the following headers on outbound webhook calls:

| Header | Mode | Description |
|---|---|---|
| `x-bonsai-request-id` | Always | UUID v4. Unique identifier for this tool call. Use this to correlate the reply. |
| `x-bonsai-reply-url` | Deferred only | Full URL of the reply endpoint (e.g., `https://app.example.com/api/reply`). |
| `x-bonsai-reply-secret` | Deferred only (when configured) | The secret value from `asyncReply.secret`. Must be echoed back in the reply. |

Custom headers configured on the tool (`webhookHeaders`) are rendered through Handlebars and merged after the injected headers. Custom headers with the same key will override injected headers.

## Response Parsing

Bonsai reads the response `Content-Type` header:
- If `application/json` → body is parsed as JSON
- Otherwise → body is read as plain text

The full response is stored as the tool result:

```json
{
  "status": 200,
  "statusText": "OK",
  "headers": { ... },
  "data": { ... parsed body or raw text ... }
}
```

---

# Response Code Contract

Bonsai enforces a strict response code contract based on the tool configuration.

## Instant Mode (`asyncReply` not enabled)

| Status Code | Treatment |
|---|---|
| **200** | ✅ Success — response data becomes tool result |
| **Any other** | ❌ Error — tool call fails with `failureReason: "HTTP {code}: {text} — expected 200"` |

## Deferred Mode (`asyncReply.enabled: true`)

| Status Code | Body | Treatment |
|---|---|---|
| **202** | `{ "deferred": true }` | ✅ Deferred — pending reply created, conversation continues |
| **200** | Any | ✅ Instant success — external service responded immediately instead of deferring |
| **202** | Missing `deferred: true` | ❌ Error — `failureReason: "HTTP 202 without deferred:true body — async reply expected but not acknowledged"` |
| **Any other** | — | ❌ Error — `failureReason: "HTTP {code}: {text} — expected 200 (instant) or 202 (deferred)"` |

## Timeout

All outbound webhook calls have a hard timeout of **30 seconds**. If the external service does not respond within this window, the tool call fails with an abort error.

---

# Reply Endpoint

External services submit deferred replies to this endpoint.

## Endpoint

```
POST {APP_URL}/api/reply
```

The `APP_URL` is the Bonsai server's public URL. The full reply URL is provided in the `x-bonsai-reply-url` header on the outbound webhook call.

## Authentication

This endpoint is **unauthenticated** (no JWT required). Security is handled through:

1. **`x-bonsai-request-id` header** (mandatory) — correlates the reply to a pending tool call
2. **`x-bonsai-reply-secret` header** (mandatory) — must match the secret configured on the tool

## Request Headers

| Header | Required | Description |
|---|---|---|
| `x-bonsai-request-id` | **Yes** | The request ID from the outbound webhook call (`x-bonsai-request-id` header) |
| `x-bonsai-reply-secret` | **Yes** | The secret from the outbound webhook call (`x-bonsai-reply-secret` header) |
| `Content-Type` | — | Should be `application/json` |

## Request Body

```json
{
  "requestId": "optional-uuid-from-header",
  "data": {
    "result": "completed",
    "orderId": "ORD-12345"
  },
  "effects": [
    {
      "type": "modify_variables",
      "modifications": [
        { "variableName": "orderId", "operation": "set", "value": "ORD-12345" }
      ]
    }
  ]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `requestId` | `string` | No | Falls back to `x-bonsai-request-id` header when omitted, null, or empty |
| `data` | `object` | No | Arbitrary key-value data returned as the tool result |
| `effects` | `Effect[]` | No | Flow-control effects to apply to the conversation |

## Response

### 200 OK — Reply accepted

```json
{
  "success": true,
  "requestId": "uuid",
  "message": "Reply accepted and queued for processing"
}
```

### Error Responses

| Status | Condition | Description |
|---|---|---|
| **400** | Invalid JSON body | Body fails Zod validation |
| **404** | Unknown request ID | No pending reply found for the `requestId` |
| **409** | Already processed | Reply already received, expired, or in non-pending state |
| **422** | Missing/invalid headers | `x-bonsai-request-id` or `x-bonsai-reply-secret` missing; secret mismatch |

## Reply Lifecycle

1. Bonsai sends outbound webhook → external service receives `x-bonsai-request-id`
2. External service responds with `202 { "deferred": true }`
3. Bonsai creates a pending reply record with status `pending` and expiry (`timeoutMs`)
4. External service processes the request asynchronously
5. External service sends `POST /api/reply` with result data and/or effects
6. Bonsai validates headers, body, secret, and expiry
7. Bonsai marks the reply as `replied` and queues effects for processing
8. Bonsai emits a `tool_reply` WebSocket event to the client

If the reply arrives after `timeoutMs`, it is rejected with status `expired`.

---

# Reply Effects

The `effects` array in the reply body allows the external service to control conversation flow. Each effect is a discriminated union on the `type` field.

## Available Effects

### `modify_variables`

Set, increment, or delete conversation stage variables.

```json
{
  "type": "modify_variables",
  "modifications": [
    { "variableName": "orderId", "operation": "set", "value": "ORD-12345" },
    { "variableName": "attemptCount", "operation": "increment", "value": 1 },
    { "variableName": "tempVar", "operation": "delete" }
  ]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"modify_variables"` | Yes | Discriminator |
| `modifications` | `VariableModification[]` | Yes | Array of variable operations |

Each modification:

| Field | Type | Required | Description |
|---|---|---|---|
| `variableName` | `string` | Yes | Name of the variable |
| `operation` | `"set" \| "increment" \| "delete"` | Yes | Operation to perform |
| `value` | `any` | For `set`/`increment` | Value to set or increment by |

### `go_to_stage`

Navigate to a different stage.

```json
{
  "type": "go_to_stage",
  "stageId": "confirmation_stage"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"go_to_stage"` | Yes | Discriminator |
| `stageId` | `string` | Yes | ID of the stage to navigate to |

### `modify_user_input`

Modify the user's input for the current turn.

```json
{
  "type": "modify_user_input",
  "operation": "set",
  "value": "Updated user input"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"modify_user_input"` | Yes | Discriminator |
| `operation` | `"set" \| "append" \| "prepend"` | Yes | Operation |
| `value` | `string` | Yes | Text value |

### `modify_user_profile`

Update the user's profile data.

```json
{
  "type": "modify_user_profile",
  "modifications": [
    { "fieldName": "preferences", "operation": "set", "value": { "theme": "dark" } }
  ]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"modify_user_profile"` | Yes | Discriminator |
| `modifications` | `UserProfileModification[]` | Yes | Array of profile operations |

### `generate_response`

Control how the AI generates the next response.

```json
{
  "type": "generate_response",
  "shouldGenerate": true,
  "prescriptedResponse": "Your order has been confirmed!"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"generate_response"` | Yes | Discriminator |
| `shouldGenerate` | `boolean` | No | Whether to generate an AI response |
| `prescriptedResponse` | `string` | No | Fixed response text to use instead of AI generation |

### `call_tool`

Trigger another tool call.

```json
{
  "type": "call_tool",
  "toolId": "tool-uuid-here",
  "parameters": {
    "paramName": "paramValue"
  }
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"call_tool"` | Yes | Discriminator |
| `toolId` | `string` | Yes | ID of the tool to call |
| `parameters` | `object` | No | Parameters to pass to the tool |

### `end_conversation`

End the conversation gracefully.

```json
{
  "type": "end_conversation",
  "reason": "Order confirmed, conversation complete"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"end_conversation"` | Yes | Discriminator |
| `reason` | `string` | No | Reason for ending |

### `abort_conversation`

Abort the conversation immediately (error state).

```json
{
  "type": "abort_conversation",
  "reason": "External service detected fraud"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"abort_conversation"` | Yes | Discriminator |
| `reason` | `string` | No | Reason for aborting |

### `change_visibility`

Override message visibility for the current turn.

```json
{
  "type": "change_visibility",
  "visibility": "hidden"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"change_visibility"` | Yes | Discriminator |
| `visibility` | `"visible" \| "hidden" \| "agent_only"` | Yes | Visibility setting |

### `ban_user`

Ban the current user.

```json
{
  "type": "ban_user",
  "reason": "Terms of service violation"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"ban_user"` | Yes | Discriminator |
| `reason` | `string` | No | Reason for the ban |

---

# WebSocket Events

Bonsai emits WebSocket events to the client at key points in the webhook tool lifecycle.

## `tool_call` Event

Emitted when a webhook tool is executed. For deferred tools, this event is emitted when the outbound call completes (before the reply arrives).

### Webhook Tool Call Data

```json
{
  "type": "conversation_event",
  "eventType": "tool_call",
  "eventData": {
    "toolType": "webhook",
    "toolId": "tool-uuid",
    "toolName": "Check Order Status",
    "status": "deferred",
    "requestId": "request-uuid",
    "parameters": { ... },
    "result": {
      "status": 202,
      "statusText": "Accepted",
      "headers": { ... },
      "data": { "deferred": true }
    },
    "durationMs": 120,
    "startMs": 1719000000000,
    "endMs": 1719000000120
  }
}
```

| Field | Description |
|---|---|
| `toolType` | Always `"webhook"` for webhook tools |
| `status` | `"completed"`, `"deferred"`, or `"failed"` |
| `requestId` | UUID for correlating with the reply (webhook tools only) |
| `result` | Full HTTP response object (`status`, `statusText`, `headers`, `data`) |

## `tool_reply` Event

Emitted when a deferred reply is processed (or fails).

```json
{
  "type": "conversation_event",
  "eventType": "tool_reply",
  "eventData": {
    "requestId": "request-uuid",
    "toolId": "tool-uuid",
    "status": "completed",
    "hasEffects": true,
    "effectsCount": 2,
    "hasData": true,
    "result": {
      "transactionId": "TX-54321",
      "status": "approved"
    }
  }
}
```

| Field | Description |
|---|---|
| `requestId` | The request ID from the original tool call |
| `toolId` | ID of the tool that was replied to |
| `status` | `"completed"` or `"failed"` |
| `error` | Present when `status: "failed"` — error summary |
| `hasEffects` | Whether the reply included effects |
| `effectsCount` | Number of effects in the reply |
| `hasData` | Whether the reply included data |
| `result` | The actual `data` payload from the reply (same as what was sent in the reply body) |
| `aborted` | Present when the reply effects caused the conversation to abort |

---

# Error Handling

## Outbound Call Errors

| Scenario | Result |
|---|---|
| Network failure / DNS error | Tool fails with `failureReason` containing the error message |
| Timeout (30s) | Tool fails with abort error |
| Invalid URL (after templating) | Throws `InvalidOperationError` |
| Non-HTTP(S) URL scheme | Throws `InvalidOperationError` |
| Response code violates contract | Tool fails with descriptive `failureReason` |

## Reply Errors

| Scenario | HTTP Status | Client Event |
|---|---|---|
| Missing `x-bonsai-request-id` header | 422 | `tool_reply` with `status: "failed"` |
| Missing `x-bonsai-reply-secret` header | 422 | `tool_reply` with `status: "failed"` |
| Secret mismatch | 422 | `tool_reply` with `status: "failed"` |
| Unknown `requestId` | 404 | No event (no pending reply to correlate) |
| Reply already processed | 409 | No event (already handled) |
| Reply expired | 409 | No event (timed out) |
| Invalid body (Zod validation) | 400 | `tool_reply` with `status: "failed"` (pending reply marked `failed_validation`) |

## Validation Failure Protection

When a reply body fails Zod validation, Bonsai automatically marks the pending reply as `failed_validation` and emits a `tool_reply` event with `status: "failed"` to the client. This prevents pending replies from hanging indefinitely.

---

# Examples

## Response Patterns for External Services

Below are the response patterns an external service can use. Each pattern shows what Bonsai receives and how the data flows into the conversation.

### A) Instant — data only

The simplest case. The external service returns data, Bonsai stores it as the tool result.

**External service responds:**

```
HTTP/1.1 200 OK
Content-Type: application/json

{ "status": "shipped", "trackingNumber": "TN-98765" }
```

**Tool result stored in context:**

```json
{
  "status": 200,
  "statusText": "OK",
  "headers": { "content-type": "application/json" },
  "data": { "status": "shipped", "trackingNumber": "TN-98765" }
}
```

**Template access:** `{{results.tools.<toolId>.result.data.status}}` → `"shipped"`

---

### B) Instant — data + effects

The external service returns both data and flow-control effects in the same response. Effects are processed immediately after the tool result is stored.

**External service responds:**

```
HTTP/1.1 200 OK
Content-Type: application/json

{
  "status": "approved",
  "transactionId": "TX-54321",
  "effects": [
    {
      "type": "modify_variables",
      "modifications": [
        { "variableName": "paymentStatus", "operation": "set", "value": "approved" }
      ]
    },
    {
      "type": "go_to_stage",
      "stageId": "payment_confirmed"
    }
  ]
}
```

**What happens:**
1. Tool result stored in `context.results.tools.<toolId>` (full `{ status, statusText, headers, data }` object)
2. Effects extracted from `data.effects` array
3. `modify_variables` sets `paymentStatus` to `"approved"`
4. `go_to_stage` navigates to `payment_confirmed` stage

**Template access:** `{{results.tools.<toolId>.result.data.transactionId}}` → `"TX-54321"`

---

### C) Instant — effects only

The external service only needs to trigger effects, no data payload needed.

**External service responds:**

```
HTTP/1.1 200 OK
Content-Type: application/json

{
  "effects": [
    {
      "type": "go_to_stage",
      "stageId": "error_handling"
    }
  ]
}
```

**What happens:**
1. Tool result stored with `data: { effects: [...] }`
2. Effects processed immediately, conversation navigates to `error_handling` stage

---

### D) Deferred — data only reply

The external service processes asynchronously and replies with just data. No effects are buffered — the reply is marked completed immediately.

**External service sends to `/api/reply`:**

```json
{
  "data": {
    "transactionId": "TX-54321",
    "status": "approved"
  }
}
```

**Tool result stored in context (after flush):**

```json
{
  "data": {
    "transactionId": "TX-54321",
    "status": "approved"
  },
  "deferred": true
}
```

**Template access:** `{{results.tools.<toolId>.result.data.transactionId}}` → `"TX-54321"`

**`tool_reply` WebSocket event:**

```json
{
  "requestId": "request-uuid",
  "toolId": "tool-uuid",
  "status": "completed",
  "hasEffects": false,
  "effectsCount": 0,
  "hasData": true,
  "result": {
    "transactionId": "TX-54321",
    "status": "approved"
  }
}
```

---

### E) Deferred — effects only reply

The external service only needs to trigger effects, no data payload.

**External service sends to `/api/reply`:**

```json
{
  "effects": [
    {
      "type": "modify_variables",
      "modifications": [
        { "variableName": "fraudFlag", "operation": "set", "value": true }
      ]
    },
    {
      "type": "abort_conversation",
      "reason": "Fraud detected by external service"
    }
  ]
}
```

**What happens:**
1. Reply buffered (has effects)
2. At next checkpoint (transition to `awaiting_user_input`), effects are executed
3. Variables modified, then conversation aborted

**`tool_reply` WebSocket event:**

```json
{
  "requestId": "request-uuid",
  "toolId": "tool-uuid",
  "status": "completed",
  "hasEffects": true,
  "effectsCount": 2,
  "hasData": false,
  "aborted": true
}
```

---

### F) Deferred — data + effects reply

The most common pattern. Data is stored in context, effects are executed at the next checkpoint.

**External service sends to `/api/reply`:**

```json
{
  "data": {
    "orderId": "ORD-12345",
    "trackingUrl": "https://track.example.com/ORD-12345"
  },
  "effects": [
    {
      "type": "modify_variables",
      "modifications": [
        { "variableName": "orderId", "operation": "set", "value": "ORD-12345" }
      ]
    },
    {
      "type": "go_to_stage",
      "stageId": "order_confirmed"
    }
  ]
}
```

**What happens:**
1. `replyData` stored in `completedToolResults`
2. Reply buffered (has effects)
3. At next checkpoint, `completedToolResults` merged into `context.results.tools`
4. Effects executed: `orderId` variable set, stage navigated to `order_confirmed`

**Template access (after flush):** `{{results.tools.<toolId>.result.data.trackingUrl}}` → `"https://track.example.com/ORD-12345"`

**`tool_reply` WebSocket event:**

```json
{
  "requestId": "request-uuid",
  "toolId": "tool-uuid",
  "status": "completed",
  "hasEffects": true,
  "effectsCount": 2,
  "hasData": true,
  "result": {
    "orderId": "ORD-12345",
    "trackingUrl": "https://track.example.com/ORD-12345"
  }
}
```

---

### G) Deferred — reply with `end_conversation`

The external service signals the conversation should end.

**External service sends to `/api/reply`:**

```json
{
  "data": {
    "finalStatus": "completed"
  },
  "effects": [
    {
      "type": "end_conversation",
      "reason": "All processing complete"
    }
  ]
}
```

---

### H) Deferred — reply with `modify_user_input`

The external service modifies the user's input for the current turn.

**External service sends to `/api/reply`:**

```json
{
  "data": {
    "normalizedQuery": "What is my order status?"
  },
  "effects": [
    {
      "type": "modify_user_input",
      "operation": "set",
      "value": "What is my order status?"
    }
  ]
}
```

---

### Data structure reference

| Source | Stored in `context.results.tools.<toolId>.result` as |
|---|---|
| Instant webhook | `{ status, statusText, headers, data }` |
| Deferred reply | `{ data: Record<string, unknown>, deferred: true }` |
| Script tool | Script return value (any type) |
| Smart function | LLM text string |

In all cases, `{{results.tools.<toolId>.result.data}}` accesses the actual payload. For instant webhooks, `.data` is the parsed response body. For deferred replies, `.data` is the `data` object from the reply body.

---

## Example 1: Instant Webhook Call

**Tool configuration:**

```json
{
  "type": "webhook",
  "url": "https://api.example.com/orders/{{tool.parameters.orderId}}",
  "webhookMethod": "GET"
}
```

**Outbound request:**

```
GET /api/orders/ORD-12345
Host: api.example.com
Content-Type: application/json
x-bonsai-request-id: a1b2c3d4-...
```

**Expected response:**

```
HTTP/1.1 200 OK
Content-Type: application/json

{ "status": "shipped", "trackingNumber": "TN-98765" }
```

**Tool result:**

```json
{
  "success": true,
  "result": {
    "status": 200,
    "statusText": "OK",
    "headers": { "content-type": "application/json" },
    "data": { "status": "shipped", "trackingNumber": "TN-98765" }
  }
}
```

## Example 2: Deferred Webhook Call

**Tool configuration:**

```json
{
  "type": "webhook",
  "url": "https://api.example.com/process-payment",
  "webhookMethod": "POST",
  "webhookBody": "{ \"amount\": {{tool.parameters.amount}}, \"currency\": \"USD\" }",
  "asyncReply": {
    "enabled": true,
    "timeoutMs": 120000,
    "secret": "sk-live-abc123"
  }
}
```

### Step 1: Outbound call

```
POST /process-payment
Host: api.example.com
Content-Type: application/json
x-bonsai-request-id: a1b2c3d4-...
x-bonsai-reply-url: https://bonsai.example.com/api/reply
x-bonsai-reply-secret: sk-live-abc123

{ "amount": 9999, "currency": "USD" }
```

### Step 2: External service acknowledges

```
HTTP/1.1 202 Accepted
Content-Type: application/json

{ "deferred": true, "requestId": "a1b2c3d4-..." }
```

Bonsai creates a pending reply record. Conversation continues (does not block).

### Step 3: External service processes payment (after 30 seconds)

### Step 4: External service submits reply

```
POST https://bonsai.example.com/api/reply
Content-Type: application/json
x-bonsai-request-id: a1b2c3d4-...
x-bonsai-reply-secret: sk-live-abc123

{
  "data": {
    "transactionId": "TX-54321",
    "status": "approved"
  },
  "effects": [
    {
      "type": "modify_variables",
      "modifications": [
        { "variableName": "transactionId", "operation": "set", "value": "TX-54321" },
        { "variableName": "paymentStatus", "operation": "set", "value": "approved" }
      ]
    },
    {
      "type": "go_to_stage",
      "stageId": "payment_confirmed"
    }
  ]
}
```

### Step 5: Bonsai responds

```
HTTP/1.1 200 OK
Content-Type: application/json

{
  "success": true,
  "requestId": "a1b2c3d4-...",
  "message": "Reply accepted and queued for processing"
}
```

### Step 6: Bonsai processes effects

Bonsai executes the effects through the ActionsExecutor pipeline:
1. Sets `transactionId` and `paymentStatus` variables
2. Navigates to `payment_confirmed` stage

### Step 7: Client receives `tool_reply` event

```json
{
  "type": "conversation_event",
  "eventType": "tool_reply",
  "eventData": {
    "requestId": "a1b2c3d4-...",
    "toolId": "tool-uuid",
    "status": "completed",
    "hasEffects": true,
    "effectsCount": 2,
    "hasData": true,
    "result": {
      "transactionId": "TX-54321",
      "status": "approved"
    }
  }
}
```

## Example 3: Deferred tool responds instantly

The external service is configured for deferred mode but responds immediately:

```
HTTP/1.1 200 OK
Content-Type: application/json

{ "result": "already-processed", "cacheHit": true }
```

Bonsai treats this as an instant success. No pending reply is created. The tool result contains the full response object.

## Example 4: Reply validation failure

External service sends an invalid effect type:

```
POST /api/reply
x-bonsai-request-id: a1b2c3d4-...
x-bonsai-reply-secret: sk-live-abc123

{
  "effects": [
    { "type": "invalid_effect_type", "foo": "bar" }
  ]
}
```

Bonsai:
1. Rejects with HTTP 400
2. Marks pending reply as `failed_validation`
3. Emits `tool_reply` event with `status: "failed"`, `error: "effects[0].type: Invalid discriminator value"`

## Example 5: Reply after timeout

External service replies after the configured `timeoutMs` (e.g., 120 seconds when timeout is 120000ms):

```
HTTP/1.1 409 Conflict
Content-Type: application/json

{ "error": "Tool reply has expired" }
```

The pending reply is marked as `expired`. No client event is emitted.

---
