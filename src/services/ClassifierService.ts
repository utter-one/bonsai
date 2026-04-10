import { injectable, inject } from 'tsyringe';
import { eq, and, SQL, desc, sql } from 'drizzle-orm';
import { buildTextSearchCondition } from '../utils/textSearch';
import { db } from '../db/index';
import { classifiers } from '../db/schema';
import type { CreateClassifierRequest, UpdateClassifierRequest, ClassifierResponse, ClassifierListResponse, CloneClassifierRequest } from '../http/contracts/classifier';
import type { ListParams } from '../http/contracts/common';
import { classifierResponseSchema, classifierListResponseSchema } from '../http/contracts/classifier';
import { AuditService } from './AuditService';
import { OptimisticLockError, NotFoundError } from '../errors';
import { buildFilterCondition, buildOrderBy } from '../utils/queryBuilder';
import { countRows, normalizeListLimit } from '../utils/pagination';
import { logger } from '../utils/logger';
import { BaseService } from './BaseService';
import type { RequestContext } from './RequestContext';
import { PERMISSIONS } from '../permissions';
import { generateId, ID_PREFIXES } from '../utils/idGenerator';

/**
 * Service for managing classifiers with full CRUD operations and audit logging
 * Classifiers are used to categorize or classify user inputs in conversations
 */
@injectable()
export class ClassifierService extends BaseService {
  constructor(@inject(AuditService) private readonly auditService: AuditService) {
    super();
  }

  /**
   * Creates a new classifier and logs the creation in the audit trail
   * @param input - Classifier creation data including id, name, prompt, and optional configuration
   * @param context - Request context for auditing and authorization
   * @returns The created classifier
   */
  async createClassifier(projectId: string, input: CreateClassifierRequest, context: RequestContext): Promise<ClassifierResponse> {
    this.requirePermission(context, PERMISSIONS.CLASSIFIER_WRITE);
    await this.requireProjectNotArchived(projectId);
    const classifierId = input.id ?? generateId(ID_PREFIXES.CLASSIFIER);
    logger.info({ classifierId, projectId, name: input.name, operatorId: context?.operatorId }, 'Creating classifier');

    try {
      const classifier = await db.insert(classifiers).values({ id: classifierId, projectId, name: input.name, description: input.description ?? null, prompt: input.prompt, llmProviderId: input.llmProviderId ?? null, llmSettings: input.llmSettings ?? null, tags: input.tags ?? [], metadata: input.metadata ?? null, version: 1 }).returning();

      const createdClassifier = classifier[0];

      await this.auditService.logCreate('classifier', createdClassifier.id, createdClassifier, context?.operatorId);

      logger.info({ classifierId: createdClassifier.id }, 'Classifier created successfully');

      return classifierResponseSchema.parse(createdClassifier);
    } catch (error) {
      logger.error({ error, classifierId: input.id }, 'Failed to create classifier');
      throw error;
    }
  }

  /**
   * Retrieves a classifier by its unique identifier
   * @param id - The unique identifier of the classifier
   * @returns The classifier if found
   * @throws {NotFoundError} When classifier is not found
   */
  async getClassifierById(projectId: string, id: string): Promise<ClassifierResponse> {
    logger.debug({ classifierId: id }, 'Fetching classifier by ID');

    try {
      const classifier = await db.query.classifiers.findFirst({ where: and(eq(classifiers.projectId, projectId), eq(classifiers.id, id)) });

      if (!classifier) {
        throw new NotFoundError(`Classifier with id ${id} not found`);
      }

      const archived = !(await this.isProjectActive(projectId));
      return classifierResponseSchema.parse({ ...classifier, archived });
    } catch (error) {
      logger.error({ error, classifierId: id }, 'Failed to fetch classifier');
      throw error;
    }
  }

  /**
   * Lists classifiers with flexible filtering, sorting, and pagination
   * @param params - List parameters including filters, sorting, pagination, and text search
   * @returns Paginated array of classifiers matching the criteria
   */
  async listClassifiers(projectId: string, params?: ListParams): Promise<ClassifierListResponse> {
    logger.debug({ params }, 'Listing classifiers');

    try {
      const conditions: SQL[] = [eq(classifiers.projectId, projectId)];
      const offset = params?.offset ?? 0;
      const limit = normalizeListLimit(params?.limit);

      // Column map for filter and order by operations
      const columnMap = {
        id: classifiers.id,
        projectId: classifiers.projectId,
        name: classifiers.name,
        llmProviderId: classifiers.llmProviderId,
        version: classifiers.version,
        createdAt: classifiers.createdAt,
        updatedAt: classifiers.updatedAt,
      };

      // Apply filters
      if (params?.filters) {
        for (const [field, filter] of Object.entries(params.filters)) {
          if (field === 'tags') {
            const tagsArray = Array.isArray(filter) ? filter as string[] : [filter as string];
            conditions.push(sql`${classifiers.tags} @> ${JSON.stringify(tagsArray)}::jsonb`);
            continue;
          }
          const condition = buildFilterCondition(field, filter, columnMap, logger);
          if (condition) {
            conditions.push(condition);
          }
        }
      }

      // Apply text search (searches name by ilike, or tags JSONB containment for "tag:" prefix)
      if (params?.textSearch) {
        const searchCondition = buildTextSearchCondition(params.textSearch, [classifiers.name], classifiers.tags);
        if (searchCondition) conditions.push(searchCondition);
      }

      // Build order by clause
      const orderByClause = buildOrderBy(params?.orderBy, columnMap);
      const whereCondition = conditions.length > 0 ? and(...conditions) : undefined;

      const total = await countRows(classifiers, whereCondition);

      // Get paginated results
      const classifierList = await db.query.classifiers.findMany({
        where: whereCondition,
        orderBy: orderByClause.length > 0 ? orderByClause : [desc(classifiers.createdAt)],
        limit,
        offset,
      });

      const archived = !(await this.isProjectActive(projectId));
      return classifierListResponseSchema.parse({
        items: classifierList.map(c => ({ ...c, archived })),
        total,
        offset,
        limit,
      });
    } catch (error) {
      logger.error({ error, params }, 'Failed to list classifiers');
      throw error;
    }
  }

  /**
   * Updates a classifier using optimistic locking to prevent concurrent modifications
   * @param id - The unique identifier of the classifier to update
   * @param input - Classifier update data (with version)
   * @param context - Request context for auditing and authorization
   * @returns The updated classifier
   * @throws {NotFoundError} When classifier is not found
   * @throws {OptimisticLockError} When the version doesn't match (concurrent modification detected)
   */
  async updateClassifier(projectId: string, id: string, input: UpdateClassifierRequest, context: RequestContext): Promise<ClassifierResponse> {
    this.requirePermission(context, PERMISSIONS.CLASSIFIER_WRITE);
    await this.requireProjectNotArchived(projectId);
    const { version: expectedVersion, ...updateData } = input;
    logger.info({ classifierId: id, expectedVersion, operatorId: context?.operatorId }, 'Updating classifier');

    try {
      const existingClassifier = await db.query.classifiers.findFirst({ where: and(eq(classifiers.projectId, projectId), eq(classifiers.id, id)) });

      if (!existingClassifier) {
        throw new NotFoundError(`Classifier with id ${id} not found`);
      }

      if (existingClassifier.version !== expectedVersion) {
        throw new OptimisticLockError(`Classifier version mismatch. Expected ${expectedVersion}, got ${existingClassifier.version}`);
      }

      const updatePayload: any = { version: existingClassifier.version + 1, updatedAt: new Date() };
      if (updateData.name !== undefined) updatePayload.name = updateData.name;
      if (updateData.description !== undefined) updatePayload.description = updateData.description;
      if (updateData.prompt !== undefined) updatePayload.prompt = updateData.prompt;
      if (updateData.llmProviderId !== undefined) updatePayload.llmProviderId = updateData.llmProviderId;
      if (updateData.llmSettings !== undefined) updatePayload.llmSettings = updateData.llmSettings;
      if (updateData.tags !== undefined) updatePayload.tags = updateData.tags;
      if (updateData.metadata !== undefined) updatePayload.metadata = updateData.metadata;

      const updatedClassifier = await db.update(classifiers).set(updatePayload).where(and(eq(classifiers.projectId, projectId), eq(classifiers.id, id), eq(classifiers.version, expectedVersion))).returning();

      if (updatedClassifier.length === 0) {
        throw new OptimisticLockError(`Failed to update classifier due to version conflict`);
      }

      const classifier = updatedClassifier[0];

      await this.auditService.logUpdate('classifier', classifier.id, existingClassifier, classifier, context?.operatorId);

      logger.info({ classifierId: classifier.id, newVersion: classifier.version }, 'Classifier updated successfully');

      return classifierResponseSchema.parse(classifier);
    } catch (error) {
      logger.error({ error, classifierId: id }, 'Failed to update classifier');
      throw error;
    }
  }

  /**
   * Deletes a classifier using optimistic locking to prevent concurrent modifications
   * @param id - The unique identifier of the classifier to delete
   * @param expectedVersion - The expected version number for optimistic locking
   * @param context - Request context for auditing and authorization
   * @throws {NotFoundError} When classifier is not found
   * @throws {OptimisticLockError} When the version doesn't match (concurrent modification detected)
   */
  async deleteClassifier(projectId: string, id: string, expectedVersion: number, context: RequestContext): Promise<void> {
    this.requirePermission(context, PERMISSIONS.CLASSIFIER_DELETE);
    await this.requireProjectNotArchived(projectId);
    logger.info({ classifierId: id, expectedVersion, operatorId: context?.operatorId }, 'Deleting classifier');

    try {
      const existingClassifier = await db.query.classifiers.findFirst({ where: and(eq(classifiers.projectId, projectId), eq(classifiers.id, id)) });

      if (!existingClassifier) {
        throw new NotFoundError(`Classifier with id ${id} not found`);
      }

      if (existingClassifier.version !== expectedVersion) {
        throw new OptimisticLockError(`Classifier version mismatch. Expected ${expectedVersion}, got ${existingClassifier.version}`);
      }

      const deleted = await db.delete(classifiers).where(and(eq(classifiers.projectId, projectId), eq(classifiers.id, id), eq(classifiers.version, expectedVersion))).returning();

      if (deleted.length === 0) {
        throw new OptimisticLockError(`Failed to delete classifier due to version conflict`);
      }

      await this.auditService.logDelete('classifier', id, existingClassifier, context?.operatorId, projectId);

      logger.info({ classifierId: id }, 'Classifier deleted successfully');
    } catch (error) {
      logger.error({ error, classifierId: id }, 'Failed to delete classifier');
      throw error;
    }
  }

  /**
   * Creates a copy of an existing classifier with a new ID and optional name override
   * @param id - The unique identifier of the classifier to clone
   * @param input - Clone options including optional new id and name
   * @param context - Request context for auditing and authorization
   * @returns The newly created cloned classifier
   * @throws {NotFoundError} When the source classifier is not found
   */
  async cloneClassifier(projectId: string, id: string, input: CloneClassifierRequest, context: RequestContext): Promise<ClassifierResponse> {
    this.requirePermission(context, PERMISSIONS.CLASSIFIER_WRITE);
    await this.requireProjectNotArchived(projectId);
    logger.info({ id, operatorId: context?.operatorId }, 'Cloning classifier');

    try {
      const existingClassifier = await db.query.classifiers.findFirst({ where: and(eq(classifiers.projectId, projectId), eq(classifiers.id, id)) });

      if (!existingClassifier) {
        throw new NotFoundError(`Classifier with id ${id} not found`);
      }

      return await this.createClassifier(projectId, { id: input.id, name: input.name ?? `${existingClassifier.name} (Clone)`, description: existingClassifier.description ?? undefined, prompt: existingClassifier.prompt, llmProviderId: existingClassifier.llmProviderId, llmSettings: existingClassifier.llmSettings as any, tags: existingClassifier.tags as string[], metadata: existingClassifier.metadata ?? undefined }, context);
    } catch (error) {
      logger.error({ error, id }, 'Failed to clone classifier');
      throw error;
    }
  }

  /**
   * Retrieves all audit log entries for a specific classifier
   * @param classifierId - The unique identifier of the classifier
   * @param projectId - The project ID the classifier belongs to
   * @returns Array of audit log entries for the classifier
   */
  async getClassifierAuditLogs(classifierId: string, projectId: string): Promise<any[]> {
    logger.debug({ classifierId, projectId }, 'Fetching audit logs for classifier');

    try {
      return await this.auditService.getEntityAuditLogs('classifier', classifierId, projectId);
    } catch (error) {
      logger.error({ error, classifierId, projectId }, 'Failed to fetch classifier audit logs');
      throw error;
    }
  }
}
