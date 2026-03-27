import { z } from 'zod';
import { parameterValueSchema } from './parameters';

export const classificationResultSchema = z.object({
  actions: z.record(z.string(), z.record(z.string(), parameterValueSchema)).optional().default({}),
});

export const actionClassificationResultSchema = z.object({
  name: z.string(),
  parameters: z.record(z.string(), parameterValueSchema),
});

export type ActionClassificationResult = z.infer<typeof actionClassificationResultSchema>;

export const actionClassificationResultWithClassifierSchema = z.object({
  classifierId: z.string(),
  classifierName: z.string(),
  actions: z.array(actionClassificationResultSchema),
});

export type ActionClassificationResultWithClassifier = z.infer<typeof actionClassificationResultWithClassifierSchema>;

export const sampleCopyClassificationResultSchema = z.object({
  sampleCopyId: z.string(),
  sampleCopyName: z.string(),
});

export type SampleCopyClassificationResult = z.infer<typeof sampleCopyClassificationResultSchema>;
