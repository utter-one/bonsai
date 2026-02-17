import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

/**
 * Schema for parameter types supported in stage actions and tools
 * Defines the valid parameter types that can be extracted from user input or passed to tools
 */
export const parameterTypeSchema = z.enum([
  'string',
  'number',
  'boolean',
  'object',
  'string[]',
  'number[]',
  'boolean[]',
  'object[]',
  'image',
  'image[]',
  'audio',
  'audio[]',
]).describe('Type of the parameter: string, number, boolean, object (free-form JSON), arrays of these, image (multimodal image with metadata), image[] (array of images), audio (multimodal audio with metadata), audio[] (array of audio)');

/**
 * Schema for image parameter value structure for multimodal parameters
 * Contains base64-encoded image data with metadata for interpretation
 */
export const imageParameterValueSchema = z.object({
  data: z.string().describe('Base64-encoded image data'),
  mimeType: z.string().describe('MIME type of the image (e.g., image/png, image/jpeg, image/webp)'),
  metadata: z.object({
    width: z.number().optional().describe('Image width in pixels'),
    height: z.number().optional().describe('Image height in pixels'),
  }).passthrough().optional().describe('Optional metadata about the image'),
}).openapi('ImageParameterValue').describe('Image parameter value structure for multimodal parameters');

export type ImageParameterValue = z.infer<typeof imageParameterValueSchema>;

/**
 * Schema for audio parameter value structure for multimodal parameters
 * Contains base64-encoded audio data with metadata for interpretation
 */
export const audioParameterValueSchema = z.object({
  data: z.string().describe('Base64-encoded audio data'),
  format: z.enum(['pcm', 'mp3', 'wav', 'opus']).describe('Audio format identifier (pcm, mp3, wav, opus)'),
  mimeType: z.string().describe('MIME type of the audio (e.g., audio/pcm, audio/mpeg, audio/wav)'),
  metadata: z.object({
    sampleRate: z.number().optional().describe('Sample rate in Hz (e.g., 44100, 48000)'),
    channels: z.number().optional().describe('Number of audio channels (1 for mono, 2 for stereo)'),
    bitDepth: z.number().optional().describe('Bit depth per sample (e.g., 16, 24)'),
  }).passthrough().optional().describe('Optional metadata about the audio'),
}).openapi('AudioParameterValue').describe('Audio parameter value structure for multimodal parameters');

export type AudioParameterValue = z.infer<typeof audioParameterValueSchema>;

export const parameterValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.object({}).passthrough(), // For free-form JSON objects
  z.array(z.string()),
  z.array(z.number()),
  z.array(z.boolean()),
  z.array(z.object({}).passthrough()), // For arrays of free-form JSON objects
  imageParameterValueSchema,
  audioParameterValueSchema,
]).openapi('ParameterValue').describe('Value of the parameter, can be a primitive type, an array of primitives, a free-form JSON object, or a multimodal parameter (image or audio)');

export type ParameterValue = z.infer<typeof parameterValueSchema>;