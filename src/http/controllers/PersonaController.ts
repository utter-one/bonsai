import { inject, singleton } from 'tsyringe';
import type { Request, Response, Router } from 'express';
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { PERMISSIONS } from '../../permissions';
import { PersonaService } from '../../services/PersonaService';
import { createPersonaSchema, updatePersonaBodySchema, deletePersonaBodySchema, personaRouteParamsSchema, personaResponseSchema, personaListResponseSchema, clonePersonaSchema } from '../contracts/persona';
import type { CreatePersonaRequest, UpdatePersonaRequest, DeletePersonaRequest, ClonePersonaRequest } from '../contracts/persona';
import { listParamsSchema } from '../contracts/common';
import { checkPermissions } from '../../utils/permissions';
import { asyncHandler } from '../../utils/asyncHandler';
import logger from '../../utils/logger';

/**
 * Controller for persona management with explicit routing
 */
@singleton()
export class PersonaController {
  constructor(@inject(PersonaService) private readonly personaService: PersonaService) { }

  /**
   * Get OpenAPI path definitions for this controller
   */
  static getOpenAPIPaths(): RouteConfig[] {
    return [
      {
        method: 'post',
        path: '/api/personas',
        tags: ['Personas'],
        summary: 'Create a new persona',
        description: 'Creates a new AI persona with specified characteristics and voice configuration',
        request: {
          body: {
            content: {
              'application/json': {
                schema: createPersonaSchema,
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Persona created successfully',
            content: {
              'application/json': {
                schema: personaResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
          409: { description: 'Persona already exists' },
        },
      },
      {
        method: 'get',
        path: '/api/personas/{id}',
        tags: ['Personas'],
        summary: 'Get persona by ID',
        description: 'Retrieves a single persona by their unique identifier',
        request: {
          params: personaRouteParamsSchema,
        },
        responses: {
          200: {
            description: 'Persona retrieved successfully',
            content: {
              'application/json': {
                schema: personaResponseSchema,
              },
            },
          },
          404: { description: 'Persona not found' },
        },
      },
      {
        method: 'get',
        path: '/api/personas',
        tags: ['Personas'],
        summary: 'List personas',
        description: 'Retrieves a paginated list of personas with optional filtering',
        request: {
          query: listParamsSchema,
        },
        responses: {
          200: {
            description: 'List of personas retrieved successfully',
            content: {
              'application/json': {
                schema: personaListResponseSchema,
              },
            },
          },
          400: { description: 'Invalid query parameters' },
        },
      },
      {
        method: 'put',
        path: '/api/personas/{id}',
        tags: ['Personas'],
        summary: 'Update persona',
        description: 'Updates an existing persona with optimistic locking',
        request: {
          params: personaRouteParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: updatePersonaBodySchema,
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Persona updated successfully',
            content: {
              'application/json': {
                schema: personaResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
          404: { description: 'Persona not found' },
          409: { description: 'Version conflict - entity was modified' },
        },
      },
      {
        method: 'delete',
        path: '/api/personas/{id}',
        tags: ['Personas'],
        summary: 'Delete persona',
        description: 'Deletes a persona with optimistic locking',
        request: {
          params: personaRouteParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: deletePersonaBodySchema,
              },
            },
          },
        },
        responses: {
          204: { description: 'Persona deleted successfully' },
          400: { description: 'Invalid request body' },
          404: { description: 'Persona not found' },
          409: { description: 'Version conflict - entity was modified' },
        },
      },
      {
        method: 'get',
        path: '/api/personas/{id}/audit-logs',
        tags: ['Personas'],
        summary: 'Get persona audit logs',
        description: 'Retrieves audit logs for a specific persona',
        request: {
          params: personaRouteParamsSchema,
        },
        responses: {
          200: {
            description: 'Audit logs retrieved successfully',
          },
          404: { description: 'Persona not found' },
        },
      },
      {
        method: 'post',
        path: '/api/personas/{id}/clone',
        tags: ['Personas'],
        summary: 'Clone persona',
        description: 'Creates a copy of an existing persona with a new ID and optional name override',
        request: {
          params: personaRouteParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: clonePersonaSchema,
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Persona cloned successfully',
            content: {
              'application/json': {
                schema: personaResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
          404: { description: 'Persona not found' },
        },
      },
    ];
  }

  /**
   * Register all routes for this controller
   */
  registerRoutes(router: Router): void {
    router.post('/api/personas', asyncHandler(this.createPersona.bind(this)));
    router.get('/api/personas/:id', asyncHandler(this.getPersonaById.bind(this)));
    router.get('/api/personas', asyncHandler(this.listPersonas.bind(this)));
    router.put('/api/personas/:id', asyncHandler(this.updatePersona.bind(this)));
    router.delete('/api/personas/:id', asyncHandler(this.deletePersona.bind(this)));
    router.get('/api/personas/:id/audit-logs', asyncHandler(this.getPersonaAuditLogs.bind(this)));
    router.post('/api/personas/:id/clone', asyncHandler(this.clonePersona.bind(this)));
  }

  /**
   * POST /api/personas
   * Create a new persona
   */
  private async createPersona(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.PERSONA_WRITE]);
    const body = createPersonaSchema.parse(req.body);
    const persona = await this.personaService.createPersona(body, req.context);
    res.status(201).json(persona);
  }

  /**
   * GET /api/personas/:id
   * Get a persona by ID
   */
  private async getPersonaById(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.PERSONA_READ]);
    const params = personaRouteParamsSchema.parse(req.params);
    const persona = await this.personaService.getPersonaById(params.id);
    res.status(200).json(persona);
  }

  /**
   * GET /api/personas
   * List personas with optional filters
   */
  private async listPersonas(req: Request, res: Response): Promise<void> {
    logger.info({ query: req.query }, 'Listing personas with query');
    checkPermissions(req, [PERMISSIONS.PERSONA_READ]);
    const query = listParamsSchema.parse(req.query);
    const personas = await this.personaService.listPersonas(query);
    res.status(200).json(personas);
  }

  /**
   * PUT /api/personas/:id
   * Update a persona
   */
  private async updatePersona(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.PERSONA_WRITE]);
    const params = personaRouteParamsSchema.parse(req.params);
    const body = updatePersonaBodySchema.parse(req.body);
    const persona = await this.personaService.updatePersona(params.id, body, req.context);
    res.status(200).json(persona);
  }

  /**
   * DELETE /api/personas/:id
   * Delete a persona
   */
  private async deletePersona(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.PERSONA_DELETE]);
    const params = personaRouteParamsSchema.parse(req.params);
    const body = deletePersonaBodySchema.parse(req.body);
    await this.personaService.deletePersona(params.id, body.version, req.context);
    res.status(204).send();
  }

  /**
   * GET /api/personas/:id/audit-logs
   * Get audit logs for a persona
   */
  private async getPersonaAuditLogs(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.AUDIT_READ]);
    const params = personaRouteParamsSchema.parse(req.params);
    const auditLogs = await this.personaService.getPersonaAuditLogs(params.id);
    res.status(200).json(auditLogs);
  }

  /**
   * POST /api/personas/:id/clone
   * Clone a persona
   */
  private async clonePersona(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.PERSONA_WRITE]);
    const params = personaRouteParamsSchema.parse(req.params);
    const body = clonePersonaSchema.parse(req.body);
    const persona = await this.personaService.clonePersona(params.id, body, req.context);
    res.status(201).json(persona);
  }
}
