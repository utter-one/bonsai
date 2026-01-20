import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

/**
 * Project request and response schemas
 */

/**
 * Schema for creating a new project
 */
export const createProjectSchema = z.object({
  name: z.string().min(1).max(255).describe('The name of the project'),
  description: z.string().optional().describe('A description of the project'),
  metadata: z.record(z.string(), z.any()).optional().describe('Additional metadata for the project'),
});

export type CreateProjectRequest = z.infer<typeof createProjectSchema>;

/**
 * Schema for updating an existing project
 */
export const updateProjectSchema = z.object({
  name: z.string().min(1).max(255).optional().describe('The updated name of the project'),
  description: z.string().optional().describe('The updated description of the project'),
  metadata: z.record(z.string(), z.any()).optional().describe('Updated metadata for the project'),
});

export type UpdateProjectRequest = z.infer<typeof updateProjectSchema>;

/**
 * Schema for project response
 */
export const projectResponseSchema = z.object({
  id: z.string().describe('The unique identifier of the project'),
  name: z.string().describe('The name of the project'),
  description: z.string().optional().describe('A description of the project'),
  metadata: z.record(z.string(), z.any()).optional().describe('Additional metadata for the project'),
  version: z.number().describe('The version number of the project'),
  createdAt: z.string().describe('The timestamp when the project was created'),
  updatedAt: z.string().describe('The timestamp when the project was last updated'),
});

export type ProjectResponse = z.infer<typeof projectResponseSchema>;

/**
 * Schema for list of projects
 */
export const projectListResponseSchema = z.object({
  items: z.array(projectResponseSchema).describe('Array of projects'),
  total: z.number().describe('Total number of projects'),
});

export type ProjectListResponse = z.infer<typeof projectListResponseSchema>;

/**
 * Schema for project route parameters
 */
export const projectRouteParamsSchema = z.object({
  id: z.string().describe('The project ID'),
});

export type ProjectRouteParams = z.infer<typeof projectRouteParamsSchema>;
