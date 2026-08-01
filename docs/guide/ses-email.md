# SES Email Channel

The SES Email channel enables text-based conversations over email using [Amazon Simple Email Service](https://aws.amazon.com/ses/). Inbound messages arrive as SNS notifications from an SES receipt rule; outbound replies are sent via the SES SendRawEmail API.

This is a **text-only, server-initiated** channel — there is no persistent client socket. Each unique email thread gets a virtual session that is automatically created on the first message and expires after a configurable inactivity period.

## When to Use SES Email

| Scenario | Recommended? |
|---|---|
| Email-based conversational agents | ✅ Yes |
| Automated email support / ticketing | ✅ Yes |
| Voice calls / IVR | ❌ No — use Twilio Voice channel |
| Browser or mobile app conversations | ❌ No — use WebSocket or WebRTC |
| SMS messaging | ❌ No — use Twilio Messaging channel |

## Prerequisites

1. An [AWS account](https://aws.amazon.com/) with SES configured.
2. A verified sender email address (or domain) in SES.
3. An SNS topic for receipt notifications.
4. An SES **receipt rule** configured to deliver inbound email to your backend.
5. A publicly reachable HTTPS URL for your Bonsai backend (SNS delivery requires HTTPS).
6. A project with at least one stage configured.

## Setup Overview

1. Create a **channel provider** record in Bonsai with your AWS credentials.
2. Create (or reuse) an **API key** with the `ses` channel permitted.
3. Configure the SES **receipt rule** to publish to an SNS topic that posts to your webhook URL.
4. Send a test email — a conversation starts automatically.

---

## Step 1: Create a Channel Provider

A channel provider stores your AWS credentials securely. Create one with `providerType: "channel"` and `apiType: "ses"`.

```http
POST /api/providers
Content-Type: application/json
Authorization: Bearer <operator-token>
```

```json
{
  "name": "My SES Email",
  "providerType": "channel",
  "apiType": "ses",
  "config": {
    "accessKeyId": "AKIAIOSFODNN7EXAMPLE",
    "secretAccessKey": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    "region": "us-east-1",
    "fromAddress": "agent@yourdomain.com",
    "threadingStrategy": "messageId",
    "inboundMode": "sns",
    "s3BucketName": "my-ses-inbound-bucket"
  }
}
```

Save the `id` from the response — you will need it in the webhook URL.

| Config Field | Description |
|---|---|
| `accessKeyId` | AWS Access Key ID with SES (and optionally S3) permissions |
| `secretAccessKey` | AWS Secret Access Key |
| `region` | AWS region (e.g. `us-east-1`) |
| `fromAddress` | Verified sender email address used for outbound replies |
| `threadingStrategy` | How thread ID is derived: `messageId` (default, follows Message-ID chain) or `senderSubject` (hashes sender + subject) |
| `inboundMode` | How inbound email body is delivered: `sns` (raw MIME in notification, 150 KB limit) or `s3` (fetched from S3 bucket, 40 MB limit) |
| `s3BucketName` | S3 bucket name for `s3` inbound mode. Must match the bucket in the SES receipt rule. Omitted for `sns` mode. |
| `processingDelayMinMs` | Minimum delay in milliseconds before processing an incoming message (default: 0, disabled) |
| `processingDelayMaxMs` | Maximum delay in milliseconds before processing an incoming message (default: 0, disabled) |

### Inbound Mode: SNS vs S3

The `inboundMode` setting must match how your SES receipt rule is configured.

| Mode | Receipt Rule Action | Max Email Size | Extra Infrastructure |
|---|---|---|---|
| `sns` | SNS action | 150 KB (including headers) | None — simplest setup |
| `s3` | S3 action + optional SNS notification | 40 MB | S3 bucket + IAM permissions |

::: warning SNS Mode Limit
With `inboundMode: "sns"`, the SES receipt rule **must use an SNS action** (not S3, Lambda, or other actions). Only the SNS action includes the raw MIME body in the `content` field. Notifications from other actions contain only metadata.
:::

::: warning S3 Mode Configuration
With `inboundMode: "s3"`, the SES receipt rule **must use an S3 action** with an optional SNS notification topic. The `s3BucketName` config value must match the bucket in the receipt rule. The AWS credentials must have `s3:GetObject` permission on that bucket.
:::

::: warning Credentials Security
The `accessKeyId` and `secretAccessKey` are stored in the provider `config` field and are readable by operators with `provider:read` permission. Use an IAM user with the minimum required permissions (SES + S3 if using S3 mode) and rotate credentials if compromised.
:::

---

## Step 2: Create (or Update) an API Key

Ensure the API key permits the `ses` channel. When `allowedChannels` is omitted, all channels are allowed.

```http
POST /api/api-keys
Content-Type: application/json
Authorization: Bearer <operator-token>
```

```json
{
  "projectId": "your-project-id",
  "name": "SES Email key",
  "allowedChannels": ["ses"],
  "allowedFeatures": ["conversation_control", "text_input", "text_output"]
}
```

Save the `key` value from the response.

---

## Step 3: Configure the SES Receipt Rule

In the [SES console](https://console.aws.amazon.com/ses/), navigate to **Email receiving > Receipt rules** and create a rule:

### SNS Mode (`inboundMode: "sns"`)

1. Add an **SNS action** that publishes to your SNS topic.
2. Set the SNS topic's HTTP/HTTPS subscription to:

```
https://your-backend.example.com/api/email/ses/inbound?apiKey=<key>&stageId=<stage-id>&channelProviderId=<provider-id>
```

3. Choose **UTF-8** encoding for the notification content.

### S3 Mode (`inboundMode: "s3"`)

1. Add an **S3 action** that delivers the raw email to your S3 bucket.
2. Optionally add an **SNS notification topic** to the S3 action (recommended for timely delivery).
3. Set the SNS topic's HTTP/HTTPS subscription to:

```
https://your-backend.example.com/api/email/ses/inbound?apiKey=<key>&stageId=<stage-id>&channelProviderId=<provider-id>
```

4. Ensure the AWS credentials in the provider config have `s3:GetObject` on the bucket.

### Query Parameters

| Parameter | Required | Description |
|---|---|---|
| `apiKey` | Yes | The API key value from Step 2 |
| `stageId` | Yes | The stage ID to start new conversations at |
| `channelProviderId` | Yes | The provider `id` from Step 1 |
| `agentId` | No | Optional agent ID override for conversation start |

::: tip One Rule Per Stage
You can configure multiple receipt rules with different SNS subscriptions (different `stageId` values) to route conversations to different flows from the same backend.
:::

---

## Step 4: Outgoing Email Conversations

You can initiate an outbound email conversation via the REST API:

```http
POST /api/email/ses/send?apiKey=<key>&channelProviderId=<provider-id>
Content-Type: application/json
```

```json
{
  "to": "customer@example.com",
  "subject": "Welcome to our service",
  "stageId": "your-starting-stage-id"
}
```

See the [SES Email API reference](../api/ses-email) for full endpoint documentation.

---

## Processing Delay

By default, incoming emails are processed immediately. To introduce a natural response delay, set `processingDelayMinMs` and `processingDelayMaxMs` on the provider config. The actual delay is picked uniformly at random from `[min, max]` per message.

Recommended for email: `30000`–`120000` (30 seconds to 2 minutes).

See [Deferred Processing](./deferred-processing) for details.

---

## Thread Continuity

The channel maintains email thread continuity using one of two strategies configured via `threadingStrategy`:

### `messageId` (default)

Walks the `In-Reply-To` / `References` header chain to find the root Message-ID. Replies to the same conversation are grouped under the same thread. A new Message-ID with no reply chain starts a new thread.

### `senderSubject`

Produces a deterministic hash from the normalized sender email + subject line. All emails from the same sender with the same subject are grouped together, regardless of Message-ID headers.

---

## Session Lifecycle

When an email arrives from a new sender (or new thread):

1. A virtual session is created and linked to a new conversation on the configured stage.
2. The email body text is delivered as the first text input.
3. The AI responds — the reply text is sent as an outbound SES email to the sender.
4. Subsequent replies within the same thread **reuse the same session** and keep the conversation context alive.

Sessions expire automatically after **24 hours of inactivity** (no new inbound emails). On expiry:
- The conversation is ended.
- The session is removed from memory.
- The next email in the same thread starts a fresh conversation.

### Inactivity Timeout

The timeout can be configured globally via an environment variable:

```
EMAIL_SESSION_TIMEOUT_MS=86400000   # 24 hours (default)
```

---

## Limitations

| Feature | Supported |
|---|---|
| Text input / output | ✅ |
| Voice input / output | ❌ |
| Commands (go-to-stage, set-var, etc.) | ❌ |
| Events (conversation_event push) | ❌ |
| Transcription updates | ❌ |
| Session authentication (per-message API key) | ✅ (via webhook URL query param) |
| MIME body parsing | ✅ (plain text, HTML-to-text fallback) |
| Inbound attachment parsing | ❌ (inbound email attachments are not parsed or forwarded) |
| Outbound file attachments | ✅ (via `attach_file` effect) |

Only `end_ai_generation_output` messages are delivered as email replies. Streaming voice chunks, image outputs, and event push messages are silently discarded. The MIME parser extracts plain text first, then falls back to HTML-to-text conversion, then raw HTML. Inbound attachments are silently ignored.

Outbound file attachments are supported via the [`attach_file`](./actions-and-effects#attach_file) effect. When paired with `generate_response`, files are downloaded from storage and included as email attachments. Multiple attachments are delivered in the order they were staged.

---

## Security

### Webhook Authentication

Every inbound webhook is authenticated using the `apiKey` query parameter. The key is validated against the database and checked for the `ses` channel permission. Requests with an invalid or inactive key are logged and ignored.

### Rate Limiting

Inbound webhooks are subject to IP-based rate limiting. Excessive requests from the same IP are silently dropped. SNS always responds with `200 OK` before any validation occurs (SNS requirement).

### Spam Filtering

Messages classified as spam by SES (`disposition: "spam"`) are silently ignored and not processed.

---

## AWS IAM Permissions

### SNS Mode (minimum)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ses:SendRawEmail"
      ],
      "Resource": "*"
    }
  ]
}
```

### S3 Mode (minimum)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ses:SendRawEmail"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject"
      ],
      "Resource": "arn:aws:s3:::your-inbound-bucket/*"
    }
  ]
}
```
