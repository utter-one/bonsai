import { z } from 'zod';
import { baseInputMessageSchema, baseOutputMessageSchema } from './common';

/** Authentication request from client to server. */
export const authRequestSchema = baseInputMessageSchema.extend({
  type: z.literal('auth').describe('Message type for authentication'),
  apiKey: z.string().describe('API key for authentication'),
});

export type AuthRequest = z.infer<typeof authRequestSchema>;

/** Authentication response from server to client. */
export const authResponseSchema = baseOutputMessageSchema.extend({
  type: z.literal('auth').describe('Message type for authentication response'),
  success: z.boolean().describe('Whether authentication was successful'),
  sessionId: z.string().optional().describe('Unique identifier for the automatically created session'),
  error: z.string().optional().describe('Error message if authentication failed'),
});

export type AuthResponse = z.infer<typeof authResponseSchema>;