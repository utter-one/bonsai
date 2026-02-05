import { z } from 'zod';
import { baseInputMessageSchema, baseOutputMessageSchema } from './common';
import { asrConfigSchema } from '../../http/contracts/project';

/** Authentication request from client to server. */
export const authRequestSchema = baseInputMessageSchema.extend({
  type: z.literal('auth').describe('Message type for authentication'),
  apiKey: z.string().describe('API key for authentication'),
});

export type AuthRequest = z.infer<typeof authRequestSchema>;

/** Project settings exposed to WebSocket clients after authentication. */
export const projectSettingsSchema = z.object({
  projectId: z.string().describe('Unique identifier of the project'),
  acceptVoice: z.boolean().describe('Whether conversations can accept voice input'),
  generateVoice: z.boolean().describe('Whether conversations generate voice output'),
  asrConfig: asrConfigSchema.nullable().describe('ASR configuration settings with full ASR settings'),
});

export type ProjectSettings = z.infer<typeof projectSettingsSchema>;

/** Authentication response from server to client. */
export const authResponseSchema = baseOutputMessageSchema.extend({
  type: z.literal('auth').describe('Message type for authentication response'),
  success: z.boolean().describe('Whether authentication was successful'),
  sessionId: z.string().optional().describe('Unique identifier for the automatically created session'),
  projectSettings: projectSettingsSchema.optional().describe('Project settings available after authentication'),
  error: z.string().optional().describe('Error message if authentication failed'),
});

export type AuthResponse = z.infer<typeof authResponseSchema>;