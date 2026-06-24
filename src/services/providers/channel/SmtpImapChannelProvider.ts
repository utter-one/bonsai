import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

const smtpAuthSchema = z.strictObject({
  user: z.string().describe('SMTP authentication username (usually the sender email address)'),
  pass: z.string().describe('SMTP authentication password or application-specific password'),
}).openapi('SmtpImapSmtpAuth');

const smtpConfigSchema = z.strictObject({
  host: z.string().describe('SMTP server hostname'),
  port: z.number().int().min(1).max(65535).describe('SMTP server port (e.g., 587 for STARTTLS, 465 for implicit TLS)'),
  secure: z.boolean().default(false).describe('Use implicit TLS (true) or STARTTLS (false)'),
  auth: smtpAuthSchema.describe('SMTP authentication credentials'),
}).openapi('SmtpImapSmtpConfig');

const imapAuthSchema = z.strictObject({
  user: z.string().describe('IMAP authentication username (usually the mailbox email address)'),
  pass: z.string().describe('IMAP authentication password or application-specific password'),
}).openapi('SmtpImapImapAuth');

const imapConfigSchema = z.strictObject({
  host: z.string().describe('IMAP server hostname'),
  port: z.number().int().min(1).max(65535).describe('IMAP server port (e.g., 993 for TLS, 143 for STARTTLS)'),
  secure: z.boolean().default(true).describe('Use implicit TLS (true) or STARTTLS (false)'),
  auth: imapAuthSchema.describe('IMAP authentication credentials'),
  pollingIntervalMs: z.number().int().min(1000).default(30000).describe('Fallback polling interval in milliseconds when IDLE is unavailable'),
}).openapi('SmtpImapImapConfig');

const oauth2ConfigSchema = z.strictObject({
  tokenUrl: z.string().url().describe('OAuth2 token endpoint URL (e.g. https://oauth2.googleapis.com/token for Gmail)'),
  clientId: z.string().describe('OAuth2 client ID'),
  clientSecret: z.string().describe('OAuth2 client secret'),
  refreshToken: z.string().optional().describe('OAuth2 refresh token (long-lived, managed by the OAuth2 callback/refresh service)'),
  accessToken: z.string().optional().describe('Current OAuth2 access token (managed by the OAuth2 callback/refresh service)'),
  accessTokenExpiry: z.number().int().optional().describe('Unix timestamp in milliseconds when the access token expires (managed by the OAuth2 callback/refresh service)'),
  scope: z.string().describe('OAuth2 scope string (e.g. https://www.googleapis.com/auth/gmail.modify for Gmail)'),
}).openapi('SmtpImapOauth2Config');

export const smtpImapChannelProviderConfigSchema = z.strictObject({
  projectId: z.string().describe('Project ID that this email channel belongs to (required for IMAP inbound routing)'),
  fromAddress: z.string().email().describe('Sender email address'),
  smtp: smtpConfigSchema.describe('SMTP server configuration for sending emails'),
  imap: imapConfigSchema.describe('IMAP server configuration for receiving inbound email replies'),
  threadingStrategy: z.enum(['messageId', 'senderSubject']).default('messageId').describe('How to derive thread ID for conversation continuity'),
  oauth2: oauth2ConfigSchema.optional().describe('Optional OAuth2/XOAUTH2 configuration. When present, supersedes password-based authentication for both SMTP and IMAP.'),
}).openapi('SmtpImapChannelConfig');

export type SmtpImapChannelProviderConfig = z.infer<typeof smtpImapChannelProviderConfigSchema>;
