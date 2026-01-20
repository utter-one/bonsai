import 'reflect-metadata';
import { JsonController, Get, Post, Put, Delete, Param, Body, QueryParams, HttpCode, Req } from 'routing-controllers';
import { injectable, inject } from 'tsyringe';
import { Validated } from '../decorators/validation';
import { OpenAPI } from '../decorators/openapi';
import { RequirePermissions } from '../decorators/auth';
import { PERMISSIONS } from '../../permissions';
import type { Request } from 'express';
import { PersonaService } from '../../services/PersonaService';
import { createPersonaSchema, updatePersonaBodySchema, deletePersonaBodySchema, personaResponseSchema, personaListResponseSchema } from '../contracts/persona';
import type { CreatePersonaRequest, UpdatePersonaRequest, DeletePersonaRequest } from '../contracts/persona';
import { listParamsSchema } from '../contracts/common';
import type { ListParams } from '../contracts/common';

/**
 * Controller for persona management with decorator-based routing
 */
@injectable()
@JsonController('/api/personas')
export class PersonaController {
  constructor(@inject(PersonaService) private readonly personaService: PersonaService) {}

  /**
   * POST /api/personas
   * Create a new persona
   */
  @RequirePermissions([PERMISSIONS.PERSONA_WRITE])
  @OpenAPI({
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
  })
  @Post('/')
  @HttpCode(201)
  async createPersona(@Validated(createPersonaSchema) @Body() body: CreatePersonaRequest, @Req() req: Request) {
    const persona = await this.personaService.createPersona(body, req.context);
    return persona;
  }

  /**
   * GET /api/personas/:id
   * Get a persona by ID
   */
  @RequirePermissions([PERMISSIONS.PERSONA_READ])
  @OpenAPI({
    tags: ['Personas'],
    summary: 'Get persona by ID',
    description: 'Retrieves a single persona by their unique identifier',
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
  })
  @Get('/:id')
  async getPersonaById(@Param('id') id: string) {
    const persona = await this.personaService.getPersonaById(id);
    return persona;
  }

  /**
   * GET /api/personas
   * List personas with optional filters
   */
  @RequirePermissions([PERMISSIONS.PERSONA_READ])
  @OpenAPI({
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
  })
  @Get('/')
  async listPersonas(@Validated(listParamsSchema, 'query') @QueryParams() query: ListParams) {
    return await this.personaService.listPersonas(query);
  }

  /**
   * PUT /api/personas/:id
   * Update a persona
   */
  @RequirePermissions([PERMISSIONS.PERSONA_WRITE])
  @OpenAPI({
    tags: ['Personas'],
    summary: 'Update persona',
    description: 'Updates an existing persona with optimistic locking',
    request: {
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
  })
  @Put('/:id')
  async updatePersona(@Param('id') id: string, @Validated(updatePersonaBodySchema) @Body() body: UpdatePersonaRequest, @Req() req: Request) {
    const { version, ...updateData } = body;
    const persona = await this.personaService.updatePersona(id, updateData, version, req.context);
    return persona;
  }

  /**
   * DELETE /api/personas/:id
   * Delete a persona
   */
  @RequirePermissions([PERMISSIONS.PERSONA_DELETE])
  @OpenAPI({
    tags: ['Personas'],
    summary: 'Delete persona',
    description: 'Deletes a persona with optimistic locking',
    request: {
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
  })
  @Delete('/:id')
  @HttpCode(204)
  async deletePersona(@Param('id') id: string, @Validated(deletePersonaBodySchema) @Body() body: DeletePersonaRequest, @Req() req: Request) {
    await this.personaService.deletePersona(id, body.version, req.context);
  }

  /**
   * GET /api/personas/:id/audit-logs
   * Get audit logs for a persona
   */
  @RequirePermissions([PERMISSIONS.AUDIT_READ])
  @OpenAPI({
    tags: ['Personas'],
    summary: 'Get persona audit logs',
    description: 'Retrieves audit logs for a specific persona',
    responses: {
      200: {
        description: 'Audit logs retrieved successfully',
      },
      404: { description: 'Persona not found' },
    },
  })
  @Get('/:id/audit-logs')
  async getPersonaAuditLogs(@Param('id') id: string) {
    return await this.personaService.getPersonaAuditLogs(id);
  }
}
