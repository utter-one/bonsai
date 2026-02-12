import { z } from 'zod';
import { baseInputMessageSchema, baseOutputMessageSchema } from './common';
import { asrConfigSchema } from '../../http/contracts/project';

export const sessionSettingsSchema = z.object({
  sendVoiceInput: z.boolean().optional().default(true).describe('Whether the client can send voice input'),
  sendTextInput: z.boolean().optional().default(true).describe('Whether the client can send text input'),
  receiveVoiceOutput: z.boolean().optional().default(true).describe('Whether the client wants to receive voice output'),
  receiveTranscriptionUpdates: z.boolean().optional().default(true).describe('Whether the client wants to receive intermediate transcription updates for voice input and output'),
  receiveEvents: z.boolean().optional().default(true).describe('Whether the client wants to receive all conversation events (e.g. turn start/end, agent actions)'),
});

export type SessionSettings = z.infer<typeof sessionSettingsSchema>;

/** Authentication request from client to server. */
export const authRequestSchema = baseInputMessageSchema.extend({
  type: z.literal('auth').describe('Message type for authentication'),
  apiKey: z.string().describe('API key for authentication'),
  sessionSettings: sessionSettingsSchema.optional().describe('Session settings for the client'),
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