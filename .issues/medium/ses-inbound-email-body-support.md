---
title: "SES inbound email body support via SNS or S3 receipt rule"
severity: medium
status: closed
created: 2026-06-01
updated: 2026-06-01
assignee: ""
tags: [feature, ses, email, inbound]
---

# SES inbound email body support via SNS or S3 receipt rule

## Description

The current SES inbound handler (`SesChannelHost.handleWebhook`) receives only email headers from the SNS receipt notification. It dispatches text input as `Email from {senderEmail}` with no actual message content.

This proposal adds support for extracting the real email body by configuring the SES receipt rule to deliver the raw MIME content via one of two mutually exclusive modes:

- **SNS mode** — the SNS action includes the raw MIME email in a `content` field (150 KB limit). Simplest setup, no extra infrastructure.
- **S3 mode** — the receipt rule saves the email to an S3 bucket, the notification carries `bucketName` + `objectKey`, and the handler fetches the MIME content from S3 (40 MB limit).

## Proposed Changes

### 1. Add `mailparser` dependency

New npm dependency for MIME parsing (`mailparser.simpleParser`). Handles multipart, encoding detection, HTML-to-text conversion.

### 2. Update provider config schema (`src/services/providers/channel/SesChannelProvider.ts`)

Add two fields to `sesChannelProviderConfigSchema`:

```ts
inboundMode: z.enum(['sns', 's3']).default('sns')
  // 'sns': raw MIME included in SNS notification (150 KB limit)
  // 's3': fetch raw MIME from S3 bucket (40 MB limit)

s3BucketName: z.string().optional()
  // Required when inboundMode is 's3'. Must match the S3 bucket in the SES receipt rule.
```

The `objectKey` comes from the notification's `receipt.action.objectKey` — no need to store it in config. We validate that the notification's bucket matches `s3BucketName`.

### 3. Update `SesChannelHost.ts`

**Type changes:**
- Add `content?: string` to `SesReceiptMessage` (SNS action mode)
- Add `receipt.action?: { type?: string; bucketName?: string; objectKey?: string }` (S3 action mode)

**`handleWebhook` changes:**
- Read `inboundMode` from resolved config
- Add private `extractEmailBody(rawMime: string | Buffer)` helper using `mailparser.simpleParser` — prefers plain text, falls back to HTML-to-text, then to `Email from {sender}`
- **SNS mode**: read `content` from notification, parse MIME, dispatch text
- **S3 mode**: read `bucketName` + `objectKey` from `receipt.action`, validate bucket matches config, fetch via S3 `GetObjectCommand`, parse MIME, dispatch text
- Update `dispatchTextInput` to accept the actual email body text instead of constructing `Email from ${senderEmail}`

**Error handling:**
- S3 fetch fails → log error, skip processing
- MIME parse fails → log warning, fall back to header-only message
- SNS content missing when mode is `sns` → log warning, fall back to header-only message

### 4. No DB migration needed

Config is stored as JSON in the `providers.config` column, so the new fields are additive and backward-compatible.

## Files to Modify

| File | Change |
|---|---|
| `package.json` | Add `mailparser` dependency |
| `src/services/providers/channel/SesChannelProvider.ts` | Add `inboundMode` + `s3BucketName` to config schema |
| `src/channels/email/ses/SesChannelHost.ts` | Add `content`/`action` to types, MIME parsing, S3 fetch path, update text dispatch |

## Notes

- `@aws-sdk/client-s3` is already a dependency — no new AWS SDK packages needed.
- SendGrid's inbound already gets the text body directly from the webhook payload. This brings SES to feature parity.
- AWS docs: [SNS action](https://docs.aws.amazon.com/ses/latest/dg/receiving-email-action-sns.html), [S3 action](https://docs.aws.amazon.com/ses/latest/dg/receiving-email-action-s3.html), [Notification contents](https://docs.aws.amazon.com/ses/latest/dg/receiving-email-notifications-contents.html)
- The `content` field is only present when the notification is triggered by an **SNS action**. Notifications from S3, Lambda, Bounce, Stop, or WorkMail actions do NOT include `content` — they only include metadata.
