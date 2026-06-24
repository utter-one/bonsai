# SES Email API

The SES Email channel handles inbound email via SNS notifications from an SES receipt rule, and sends outbound email via the SES SendRawEmail API. See the [SES Email Channel](../guide/ses-email) guide for setup instructions.

## Inbound Webhook Endpoint

### POST /api/email/ses/inbound

Receives an inbound SES receipt notification via SNS. This endpoint is called by SNS — not by your own clients.

**No standard API authentication** — the request is authenticated via the `apiKey` query parameter configured on the SNS subscription URL.

#### Query Parameters

| Parameter | Required | Description |
|---|---|---|
| `apiKey` | Yes | API key used to identify the project and validate channel/feature permissions |
| `stageId` | Yes | Stage ID to start new conversations at for first-time senders |
| `channelProviderId` | Yes | ID of the `channel` provider record containing AWS SES credentials |
| `agentId` | No | Optional agent ID override applied when starting new conversations |

#### Request

SNS delivers a JSON body. The handler expects an SNS notification wrapping an SES receipt:

```json
{
  "Type": "Notification",
  "Message": "{ ... SES receipt JSON ... }"
}
```

The parsed SES receipt contains:

| Field | Description |
|---|---|
| `mail.commonHeaders.from` | Sender email address — becomes `userId` for the conversation |
| `mail.commonHeaders.subject` | Email subject line |
| `mail.commonHeaders.message-id` | Original Message-ID for thread resolution |
| `mail.commonHeaders.in-reply-to` | In-Reply-To header for thread resolution |
| `mail.commonHeaders.references` | References header for thread resolution |
| `receipt.disposition` | Disposition (`spam` messages are silently ignored) |
| `receipt.action.bucketName` | S3 bucket name (S3 mode only) |
| `receipt.action.objectKey` | S3 object key (S3 mode only) |
| `content` | Raw MIME email body (SNS mode only) |

#### Response

```http
HTTP/1.1 200 OK
Content-Type: application/json
```

```json
{}
```

An empty JSON response is always returned immediately. Outbound replies are sent proactively via the SES API after the AI turn completes — not in this response body.

#### Error Responses

| Status | Cause |
|---|---|
| `429 Too Many Requests` | IP-based rate limit exceeded |

All other errors are logged silently. SNS requires a `200` response regardless of processing outcome.

---

## Outgoing Endpoint

### POST /api/email/ses/send

Initiates an outbound email conversation. Creates a session, pre-creates a conversation record, and dispatches `start_conversation` to begin the AI flow.

**No standard API authentication** — authenticated via the `apiKey` query parameter.

#### Query Parameters

| Parameter | Required | Description |
|---|---|---|
| `apiKey` | Yes | API key used to identify the project and validate channel/feature permissions |
| `channelProviderId` | Yes | ID of the `channel` provider record containing AWS SES credentials |
| `stageId` | No | Stage ID override (falls back to body `stageId`, then project default) |
| `agentId` | No | Optional agent ID override |

#### Request Body

```json
{
  "to": "customer@example.com",
  "subject": "Welcome to our service",
  "fromAddress": "override@yourdomain.com",
  "stageId": "your-starting-stage-id",
  "agentId": "your-agent-id",
  "metadata": { "source": "marketing-campaign" },
  "userProfile": { "plan": "premium" }
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `to` | `string` | Yes | Recipient email address — becomes `userId` for the conversation |
| `subject` | `string` | No | Email subject line (defaults to `"New Conversation"`) |
| `fromAddress` | `string` | No | Override sender address (defaults to provider config `fromAddress`) |
| `stageId` | `string` | No | Stage ID to start the conversation at (falls back to query param, then project default) |
| `agentId` | `string` | No | Optional agent ID override |
| `metadata` | `Record<string, unknown>` | No | Optional metadata attached to the conversation record |
| `userProfile` | `Record<string, unknown>` | No | Optional user profile data deep-merged into the user record |

#### Response

```http
HTTP/1.1 201 Created
Content-Type: application/json
```

```json
{
  "conversationId": "conv_abc123"
}
```

| Field | Description |
|---|---|
| `conversationId` | ID of the pre-created conversation record |

#### Error Responses

| Status | Cause |
|---|---|
| `400 Bad Request` | Missing or invalid query parameters; invalid request body; channel provider not found or wrong type |
| `401 Unauthorized` | API key is missing, unknown, or inactive |
| `403 Forbidden` | API key does not permit `ses` channel |
| `422 Unprocessable Entity` | No `stageId` provided and project has no default starting stage; user not found and project does not allow auto-creating users |
| `500 Internal Server Error` | Channel provider config is invalid |
| `502 Bad Gateway` | SES API call failed |

---

## Channel Provider Configuration

A channel provider for SES uses `providerType: "channel"` and `apiType: "ses"`. Manage it via the standard [Providers API](./providers).

### Config Schema

```json
{
  "accessKeyId": "AKIAIOSFODNN7EXAMPLE",
  "secretAccessKey": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  "region": "us-east-1",
  "fromAddress": "agent@yourdomain.com",
  "threadingStrategy": "messageId",
  "inboundMode": "sns",
  "s3BucketName": "my-ses-inbound-bucket"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `accessKeyId` | `string` | Yes | AWS Access Key ID with SES (and optionally S3) permissions |
| `secretAccessKey` | `string` | Yes | AWS Secret Access Key |
| `region` | `string` | Yes | AWS region (e.g. `us-east-1`) |
| `fromAddress` | `string` | Yes | Verified sender email address for outbound replies |
| `threadingStrategy` | `enum` | No | `messageId` (default) or `senderSubject` — how thread ID is derived |
| `inboundMode` | `enum` | No | `sns` (default) or `s3` — how inbound email body is delivered |
| `s3BucketName` | `string` | Conditional | Required when `inboundMode` is `s3`. Must match the S3 bucket in the SES receipt rule. |

---

## Session Management

The SES channel maintains **virtual sessions** in memory, keyed by `projectId + threadId`. No persistent socket exists.

| Event | Behaviour |
|---|---|
| First email in a thread | New session created; `start_conversation` dispatched with `userId = senderEmail`; email body text delivered |
| Subsequent emails in same thread | Same session reused; only `send_user_text_input` dispatched with the email body text |
| Inactivity timeout | Session unregistered; next email starts a fresh conversation |

### Inactivity Timeout

Default: **24 hours**. Override via environment variable:

```
EMAIL_SESSION_TIMEOUT_MS=86400000
```

---

## Webhook URL Structure

Configure this URL as the SNS subscription endpoint:

```
POST https://your-backend.example.com/api/email/ses/inbound
  ?apiKey=<api-key-value>
  &stageId=<stage-id>
  &channelProviderId=<provider-id>
  [&agentId=<agent-id>]
```

For the outgoing endpoint:

```
POST https://your-backend.example.com/api/email/ses/send
  ?apiKey=<api-key-value>
  &channelProviderId=<provider-id>
  [&stageId=<stage-id>]
  [&agentId=<agent-id>]
```
