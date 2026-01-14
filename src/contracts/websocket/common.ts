import { z } from 'zod';

/** Base structure for all client-to-server messages. */
export const baseInputMessageSchema = z.object({
  /** Unique identifier for request correlation and tracking. */
  requestId: z.string().describe('Unique identifier for request correlation and tracking'),
  /** Message type discriminator for the union type system. */
  type: z.string().describe('Message type discriminator for the union type system'),
});

export type BaseInputMessage = z.infer<typeof baseInputMessageSchema>;

/** Base structure for all server-to-client messages. */
export const baseOutputMessageSchema = z.object({
  /** Optional request ID for correlating responses with requests. */
  requestId: z.string().optional().describe('Optional request ID for correlating responses with requests'),
  /** Message type discriminator for the union type system. */
  type: z.string().describe('Message type discriminator for the union type system'),
});

export type BaseOutputMessage = z.infer<typeof baseOutputMessageSchema>;


