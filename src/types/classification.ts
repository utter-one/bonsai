import { z } from 'zod';

export const classificationResultSchema = z.object({
  actions: z.record(z.string(), z.record(z.string(), z.any())).optional().default({}),
});

export const actionClassificationResultSchema = z.object({
  name: z.string(),
  parameters: z.record(z.string(), z.any()),
});

export type ActionClassificationResult = z.infer<typeof actionClassificationResultSchema>;

export const classificationResultWithClassifierSchema = z.object({
  classifierId: z.string(),
  classifierName: z.string(),
  actions: z.array(actionClassificationResultSchema),
});

export type ClassificationResultWithClassifier = z.infer<typeof classificationResultWithClassifierSchema>;
