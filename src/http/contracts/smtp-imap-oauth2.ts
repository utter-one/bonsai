import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

export const oauth2AuthorizeBodySchema = z.strictObject({
  providerId: z.string().min(1).describe('ID of the SMTP/IMAP channel provider to configure OAuth2 for'),
  tokenUrl: z.string().url().describe('OAuth2 token endpoint URL (e.g. https://oauth2.googleapis.com/token for Gmail)'),
  authorizationUrl: z.string().url().describe('OAuth2 authorization endpoint URL (e.g. https://accounts.google.com/o/oauth2/v2/auth for Gmail)'),
  clientId: z.string().min(1).describe('OAuth2 client ID'),
  clientSecret: z.string().min(1).describe('OAuth2 client secret'),
  scope: z.string().min(1).describe('OAuth2 scope string (e.g. https://www.googleapis.com/auth/gmail.modify for Gmail)'),
  redirectUrl: z.string().url().describe('Redirect URI registered with the OAuth2 provider (must match the callback endpoint)'),
});

export const oauth2AuthorizeResponseSchema = z.strictObject({
  authorizationUrl: z.string().url().describe('Full authorization URL to redirect the user to'),
  state: z.string().describe('Random state parameter for CSRF protection'),
});

export const oauth2CallbackQuerySchema = z.object({
  code: z.string().min(1).optional().describe('Authorization code from the OAuth2 provider'),
  state: z.string().min(1).optional().describe('State parameter that was returned from the authorization URL'),
  error: z.string().optional().describe('Error code from the OAuth2 provider'),
  error_description: z.string().optional().describe('Human-readable error description from the OAuth2 provider'),
});

export const oauth2CallbackResponseSchema = z.strictObject({
  success: z.boolean().describe('Whether the OAuth2 callback was processed successfully'),
  message: z.string().describe('Human-readable result message'),
});

export const oauth2RefreshBodySchema = z.strictObject({
  providerId: z.string().min(1).describe('ID of the SMTP/IMAP channel provider to refresh tokens for'),
});

export const oauth2RefreshResponseSchema = z.strictObject({
  success: z.boolean().describe('Whether the token refresh was successful'),
  accessTokenExpiry: z.number().int().optional().describe('Unix timestamp in milliseconds when the access token expires'),
});

export type OAuth2AuthorizeBody = z.infer<typeof oauth2AuthorizeBodySchema>;
export type OAuth2AuthorizeResponse = z.infer<typeof oauth2AuthorizeResponseSchema>;
export type OAuth2CallbackQuery = z.infer<typeof oauth2CallbackQuerySchema>;
export type OAuth2CallbackResponse = z.infer<typeof oauth2CallbackResponseSchema>;
export type OAuth2RefreshBody = z.infer<typeof oauth2RefreshBodySchema>;
export type OAuth2RefreshResponse = z.infer<typeof oauth2RefreshResponseSchema>;
