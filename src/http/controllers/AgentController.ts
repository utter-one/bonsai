import { inject, singleton } from 'tsyringe';
import type { Request, Response, Router } from 'express';
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { PERMISSIONS } from '../../permissions';
import { AgentService } from '../../services/AgentService';
import { createAgentSchema, updateAgentBodySchema, deleteAgentBodySchema, agentRouteParamsSchema, agentResponseSchema, agentListResponseSchema, cloneAgentSchema } from '../contracts/agent';
import type { CreateAgentRequest, UpdateAgentRequest, DeleteAgentRequest, CloneAgentRequest } from '../contracts/agent';
import { listParamsSchema, projectScopedParamsSchema } from '../contracts/common';
import { checkPermissions } from '../../utils/permissions';
import { asyncHandler } from '../../utils/asyncHandler';
import logger from '../../utils/logger';

/**
 * Controller for agent management with explicit routing
 */
@singleton()
export class AgentController {
  constructor(@inject(AgentService) private readonly agentService: AgentService) { }

  /**
   * Get OpenAPI path definitions for this controller
   */
  static getOpenAPIPaths(): RouteConfig[] {
    return [
      {
        method: 'post',
        path: '/api/projects/{projectId}/agents',
        tags: ['Agents'],
        summary: 'Create a new agent',
        description: 'Creates a new AI agent with specified characteristics and voice configuration',
        request: {
          body: {
            content: {
              'application/json': {
                schema: createAgentSchema,
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Agent created successfully',
            content: {
              'application/json': {
                schema: agentResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
          409: { description: 'Agent already exists' },
        },
      },
      {
        method: 'get',
        path: '/api/projects/{projectId}/agents/{id}',
        tags: ['Agents'],
        summary: 'Get agent by ID',
        description: 'Retrieves a single agent by their unique identifier',
        request: {
          params: agentRouteParamsSchema,
        },
        responses: {
          200: {
            description: 'Agent retrieved successfully',
            content: {
              'application/json': {
                schema: agentResponseSchema,
              },
            },
          },
          404: { description: 'Agent not found' },
        },
      },
      {
        method: 'get',
        path: '/api/projects/{projectId}/agents',
        tags: ['Agents'],
        summary: 'List agents',
        description: 'Retrieves a paginated list of agents with optional filtering',
        request: {
          query: listParamsSchema,
        },
        responses: {
          200: {
            description: 'List of agents retrieved successfully',
            content: {
              'application/json': {
                schema: agentListResponseSchema,
              },
            },
          },
          400: { description: 'Invalid query parameters' },
        },
      },
      {
        method: 'put',
        path: '/api/projects/{projectId}/agents/{id}',
        tags: ['Agents'],
        summary: 'Update agent',
        description: 'Updates an existing agent with optimistic locking',
        request: {
          params: agentRouteParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: updateAgentBodySchema,
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Agent updated successfully',
            content: {
              'application/json': {
                schema: agentResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
          404: { description: 'Agent not found' },
          409: { description: 'Version conflict - entity was modified' },
        },
      },
      {
        method: 'delete',
        path: '/api/projects/{projectId}/agents/{id}',
        tags: ['Agents'],
        summary: 'Delete agent',
        description: 'Deletes an agent with optimistic locking',
        request: {
          params: agentRouteParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: deleteAgentBodySchema,
              },
            },
          },
        },
        responses: {
          204: { description: 'Agent deleted successfully' },
          400: { description: 'Invalid request body' },
          404: { description: 'Agent not found' },
          409: { description: 'Version conflict - entity was modified' },
        },
      },
      {
        method: 'get',
        path: '/api/projects/{projectId}/agents/{id}/audit-logs',
        tags: ['Agents'],
        summary: 'Get agent audit logs',
        description: 'Retrieves audit logs for a specific agent',
        request: {
          params: agentRouteParamsSchema,
        },
        responses: {
          200: {
            description: 'Audit logs retrieved successfully',
          },
          404: { description: 'Agent not found' },
        },
      },
      {
        method: 'post',
        path: '/api/projects/{projectId}/agents/{id}/clone',
        tags: ['Agents'],
        summary: 'Clone agent',
        description: 'Creates a copy of an existing agent with a new ID and optional name override',
        request: {
          params: agentRouteParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: cloneAgentSchema,
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Agent cloned successfully',
            content: {
              'application/json': {
                schema: agentResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
          404: { description: 'Agent not found' },
        },
      },
    ];
  }

  /**
   * Register all routes for this controller
   */
  registerRoutes(router: Router): void {
    router.post('/api/projects/:projectId/agents', asyncHandler(this.createAgent.bind(this)));
    router.get('/api/projects/:projectId/agents/:id', asyncHandler(this.getAgentById.bind(this)));
    router.get('/api/projects/:projectId/agents', asyncHandler(this.listAgents.bind(this)));
    router.put('/api/projects/:projectId/agents/:id', asyncHandler(this.updateAgent.bind(this)));
    router.delete('/api/projects/:projectId/agents/:id', asyncHandler(this.deleteAgent.bind(this)));
    router.get('/api/projects/:projectId/agents/:id/audit-logs', asyncHandler(this.getAgentAuditLogs.bind(this)));
    router.post('/api/projects/:projectId/agents/:id/clone', asyncHandler(this.cloneAgent.bind(this)));
  }

  /**
   * POST /api/agents
   * Create a new agent
   */
  private async createAgent(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.AGENT_WRITE]);
    const { projectId } = projectScopedParamsSchema.parse(req.params);
    const body = createAgentSchema.parse(req.body);
    const agent = await this.agentService.createAgent(projectId, body, req.context);
    res.status(201).json(agent);
  }

  /**
   * GET /api/agents/:id
   * Get an agent by ID
   */
  private async getAgentById(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.AGENT_READ]);
    const params = agentRouteParamsSchema.parse(req.params);
    const agent = await this.agentService.getAgentById(params.projectId, params.id);
    res.status(200).json(agent);
  }

  /**
   * GET /api/agents
   * List agents with optional filters
   */
  private async listAgents(req: Request, res: Response): Promise<void> {
    logger.info({ query: req.query }, 'Listing agents with query');
    checkPermissions(req, [PERMISSIONS.AGENT_READ]);
    const { projectId } = projectScopedParamsSchema.parse(req.params);
    const query = listParamsSchema.parse(req.query);
    const agents = await this.agentService.listAgents(projectId, query);
    res.status(200).json(agents);
  }

  /**
   * PUT /api/agents/:id
   * Update an agent
   */
  private async updateAgent(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.AGENT_WRITE]);
    const params = agentRouteParamsSchema.parse(req.params);
    const body = updateAgentBodySchema.parse(req.body);
    const agent = await this.agentService.updateAgent(params.projectId, params.id, body, req.context);
    res.status(200).json(agent);
  }

  /**
   * DELETE /api/agents/:id
   * Delete an agent
   */
  private async deleteAgent(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.AGENT_DELETE]);
    const params = agentRouteParamsSchema.parse(req.params);
    const body = deleteAgentBodySchema.parse(req.body);
    await this.agentService.deleteAgent(params.projectId, params.id, body.version, req.context);
    res.status(204).send();
  }

  /**
   * GET /api/agents/:id/audit-logs
   * Get audit logs for an agent
   */
  private async getAgentAuditLogs(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.AUDIT_READ]);
    const params = agentRouteParamsSchema.parse(req.params);
    const auditLogs = await this.agentService.getAgentAuditLogs(params.id, params.projectId);
    res.status(200).json(auditLogs);
  }

  /**
   * POST /api/agents/:id/clone
   * Clone an agent
   */
  private async cloneAgent(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.AGENT_WRITE]);
    const params = agentRouteParamsSchema.parse(req.params);
    const body = cloneAgentSchema.parse(req.body);
    const agent = await this.agentService.cloneAgent(params.projectId, params.id, body, req.context);
    res.status(201).json(agent);
  }
}
