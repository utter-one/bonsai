import { z } from 'zod';

type AnyZodObject = z.ZodObject<z.ZodRawShape>;

/**
 * Derives a WebSocket input message schema from a CAL input schema.
 *
 * The transformation strips the internal `correlationId` field and adds the
 * WebSocket transport fields `requestId` (required for correlation) and `sessionId`.
 *
 * @param calSchema - A CAL input message schema that extends `calBaseInputMessageSchema`.
 * @returns A new Zod object schema suitable for use as a WebSocket input contract.
 */
export function calToWsInput<T extends AnyZodObject>(calSchema: T) {
  return calSchema.omit({ correlationId: true } as any).extend({
    requestId: z.string().describe('Unique identifier for request correlation and tracking'),
    sessionId: z.string().describe('Unique identifier for the session'),
  });
}

/**
 * Derives a WebSocket output message schema from a CAL output schema.
 *
 * The transformation strips the internal `correlationId` field and adds the
 * WebSocket transport fields `requestId` (optional, echoed from the request) and `sessionId`.
 *
 * @param calSchema - A CAL output message schema that extends `calBaseOutputMessageSchema`.
 * @returns A new Zod object schema suitable for use as a WebSocket output contract.
 */
export function calToWsOutput<T extends AnyZodObject>(calSchema: T) {
  return calSchema.omit({ correlationId: true } as any).extend({
    requestId: z.string().optional().describe('Optional request ID for correlating responses with requests'),
    sessionId: z.string().describe('Unique identifier for the session'),
  });
}
