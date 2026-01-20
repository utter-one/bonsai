import { injectable, inject } from 'tsyringe';
import { eq, and, like, SQL, desc } from 'drizzle-orm';
import { db } from '../db/index';
import { personas } from '../db/schema';
import type { CreatePersonaRequest, UpdatePersonaRequest, PersonaResponse, PersonaListResponse } from '../http/contracts/persona';
import type { ListParams } from '../http/contracts/common';
import { personaResponseSchema, personaListResponseSchema } from '../http/contracts/persona';
import { AuditService } from './AuditService';
import { OptimisticLockError, NotFoundError } from '../errors';
import { buildFilterCondition, buildOrderBy } from '../utils/queryBuilder';
import { logger } from '../utils/logger';
import { BaseService } from './BaseService';
import type { RequestContext } from '../types/request-context';
import { PERMISSIONS } from '../permissions';

/**
 * Service for managing personas with full CRUD operations and audit logging
 */
@injectable()
export class PersonaService extends BaseService {
  constructor(@inject(AuditService) private readonly auditService: AuditService) {
    super();
  }

  /**
   * Creates a new persona and logs the creation in the audit trail
   * @param input - Persona creation data including id, name, prompt, voiceConfig, and optional metadata
   * @param context - Request context for auditing and authorization
   * @returns The created persona
   */
  async createPersona(input: CreatePersonaRequest, context: RequestContext): Promise<PersonaResponse> {
    this.requirePermission(context, PERMISSIONS.PERSONA_WRITE);
    logger.info({ personaId: input.id, projectId: input.projectId, name: input.name, adminId: context?.adminId }, 'Creating persona');

    try {
      const persona = await db.insert(personas).values({ id: input.id, projectId: input.projectId, name: input.name, prompt: input.prompt, voiceConfig: input.voiceConfig, metadata: input.metadata, version: 1 }).returning();

      const createdPersona = persona[0];

      await this.auditService.logCreate('persona', createdPersona.id, { id: createdPersona.id, projectId: createdPersona.projectId, name: createdPersona.name, prompt: createdPersona.prompt, voiceConfig: createdPersona.voiceConfig, metadata: createdPersona.metadata }, context?.adminId);

      logger.info({ personaId: createdPersona.id }, 'Persona created successfully');

      return personaResponseSchema.parse(createdPersona);
    } catch (error) {
      logger.error({ error, personaId: input.id }, 'Failed to create persona');
      throw error;
    }
  }

  /**
   * Retrieves a persona by their unique identifier
   * @param id - The unique identifier of the persona
   * @returns The persona if found
   * @throws {NotFoundError} When persona is not found
   */
  async getPersonaById(id: string): Promise<PersonaResponse> {
    logger.debug({ personaId: id }, 'Fetching persona by ID');

    try {
      const persona = await db.query.personas.findFirst({ where: eq(personas.id, id) });

      if (!persona) {
        throw new NotFoundError(`Persona with id ${id} not found`);
      }

      return personaResponseSchema.parse(persona);
    } catch (error) {
      logger.error({ error, personaId: id }, 'Failed to fetch persona');
      throw error;
    }
  }

  /**
   * Lists personas with flexible filtering, sorting, and pagination
   * @param params - List parameters including filters, sorting, pagination, and text search
   * @returns Paginated array of personas matching the criteria
   */
  async listPersonas(params?: ListParams): Promise<PersonaListResponse> {
    logger.debug({ params }, 'Listing personas');

    try {
      const conditions: SQL[] = [];
      const offset = params?.offset ?? 0;
      const limit = params?.limit ?? null;

      // Column map for filter and order by operations
      const columnMap = {
        id: personas.id,
        name: personas.name,
        version: personas.version,
        createdAt: personas.createdAt,
        updatedAt: personas.updatedAt,
      };

      // Apply filters
      if (params?.filters) {
        for (const [field, filter] of Object.entries(params.filters)) {
          const condition = buildFilterCondition(field, filter, columnMap, logger);
          if (condition) {
            conditions.push(condition);
          }
        }
      }

      // Apply text search (searches name and id)
      if (params?.textSearch) {
        const searchTerm = `%${params.textSearch}%`;
        conditions.push(like(personas.name, searchTerm));
      }

      // Build order by clause
      const orderByClause = buildOrderBy(params?.orderBy, columnMap);

      // Get total count
      const totalResult = await db.query.personas.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
      });
      const total = totalResult.length;

      // Get paginated results
      const personaList = await db.query.personas.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
        orderBy: orderByClause.length > 0 ? orderByClause : [desc(personas.createdAt)],
        limit: limit ?? undefined,
        offset,
      });

      return personaListResponseSchema.parse({
        items: personaList,
        total,
        offset,
        limit,
      });
    } catch (error) {
      logger.error({ error, params }, 'Failed to list personas');
      throw error;
    }
  }

  /**
   * Updates a persona using optimistic locking to prevent concurrent modifications
   * @param id - The unique identifier of the persona to update
   * @param input - Persona update data including name, prompt, voiceConfig, and metadata (without version)
   * @param expectedVersion - The expected version number for optimistic locking
   * @param context - Request context for auditing and authorization
   * @returns The updated persona
   * @throws {NotFoundError} When persona is not found
   * @throws {OptimisticLockError} When the version doesn't match (concurrent modification detected)
   */
  async updatePersona(id: string, input: Omit<UpdatePersonaRequest, 'version'>, expectedVersion: number, context: RequestContext): Promise<PersonaResponse> {
    this.requirePermission(context, PERMISSIONS.PERSONA_WRITE);
    logger.info({ personaId: id, expectedVersion, adminId: context?.adminId }, 'Updating persona');

    try {
      const existingPersona = await db.query.personas.findFirst({ where: eq(personas.id, id) });

      if (!existingPersona) {
        throw new NotFoundError(`Persona with id ${id} not found`);
      }

      if (existingPersona.version !== expectedVersion) {
        throw new OptimisticLockError(`Persona version mismatch. Expected ${expectedVersion}, got ${existingPersona.version}`);
      }

      const updatedPersona = await db.update(personas).set({ name: input.name, prompt: input.prompt, voiceConfig: input.voiceConfig, metadata: input.metadata, version: existingPersona.version + 1, updatedAt: new Date() }).where(and(eq(personas.id, id), eq(personas.version, expectedVersion))).returning();

      if (updatedPersona.length === 0) {
        throw new OptimisticLockError(`Failed to update persona due to version conflict`);
      }

      const persona = updatedPersona[0];

      await this.auditService.logUpdate('persona', persona.id, { id: existingPersona.id, name: existingPersona.name, prompt: existingPersona.prompt, voiceConfig: existingPersona.voiceConfig, metadata: existingPersona.metadata }, { id: persona.id, name: persona.name, prompt: persona.prompt, voiceConfig: persona.voiceConfig, metadata: persona.metadata }, context?.adminId);

      logger.info({ personaId: persona.id, newVersion: persona.version }, 'Persona updated successfully');

      return personaResponseSchema.parse(persona);
    } catch (error) {
      logger.error({ error, personaId: id }, 'Failed to update persona');
      throw error;
    }
  }

  /**
   * Deletes a persona using optimistic locking to prevent concurrent modifications
   * @param id - The unique identifier of the persona to delete
   * @param expectedVersion - The expected version number for optimistic locking
   * @param context - Request context for auditing and authorization
   * @throws {NotFoundError} When persona is not found
   * @throws {OptimisticLockError} When the version doesn't match (concurrent modification detected)
   */
  async deletePersona(id: string, expectedVersion: number, context: RequestContext): Promise<void> {
    this.requirePermission(context, PERMISSIONS.PERSONA_DELETE);
    logger.info({ personaId: id, expectedVersion, adminId: context?.adminId }, 'Deleting persona');

    try {
      const existingPersona = await db.query.personas.findFirst({ where: eq(personas.id, id) });

      if (!existingPersona) {
        throw new NotFoundError(`Persona with id ${id} not found`);
      }

      if (existingPersona.version !== expectedVersion) {
        throw new OptimisticLockError(`Persona version mismatch. Expected ${expectedVersion}, got ${existingPersona.version}`);
      }

      const deleted = await db.delete(personas).where(and(eq(personas.id, id), eq(personas.version, expectedVersion))).returning();

      if (deleted.length === 0) {
        throw new OptimisticLockError(`Failed to delete persona due to version conflict`);
      }

      await this.auditService.logDelete('persona', id, { id: existingPersona.id, name: existingPersona.name, prompt: existingPersona.prompt, voiceConfig: existingPersona.voiceConfig, metadata: existingPersona.metadata }, context?.adminId);

      logger.info({ personaId: id }, 'Persona deleted successfully');
    } catch (error) {
      logger.error({ error, personaId: id }, 'Failed to delete persona');
      throw error;
    }
  }

  /**
   * Retrieves all audit log entries for a specific persona
   * @param personaId - The unique identifier of the persona
   * @returns Array of audit log entries for the persona
   */
  async getPersonaAuditLogs(personaId: string): Promise<any[]> {
    logger.debug({ personaId }, 'Fetching audit logs for persona');

    try {
      return await this.auditService.getEntityAuditLogs('persona', personaId);
    } catch (error) {
      logger.error({ error, personaId }, 'Failed to fetch persona audit logs');
      throw error;
    }
  }
}
