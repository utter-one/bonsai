import { injectable, inject } from 'tsyringe';
import { eq, and, like, SQL, desc } from 'drizzle-orm';
import { db } from '../db/index';
import { classifiers } from '../db/schema';
import type { CreateClassifierRequest, UpdateClassifierRequest, ClassifierResponse, ClassifierListResponse } from '../http/contracts/classifier';
import type { ListParams } from '../http/contracts/common';
import { classifierResponseSchema, classifierListResponseSchema } from '../http/contracts/classifier';
import { AuditService } from './AuditService';
import { OptimisticLockError, NotFoundError } from '../errors';
import { buildFilterCondition, buildOrderBy } from '../utils/queryBuilder';
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
  async createClassifier(input: CreateClassifierRequest, context: RequestContext): Promise<ClassifierResponse> {
    this.requirePermission(context, PERMISSIONS.CLASSIFIER_WRITE);
    const classifierId = input.id ?? generateId(ID_PREFIXES.CLASSIFIER);
    logger.info({ classifierId, projectId: input.projectId, name: input.name, adminId: context?.adminId }, 'Creating classifier');

    try {
      const classifier = await db.insert(classifiers).values({ id: classifierId, projectId: input.projectId, name: input.name, description: input.description ?? null, prompt: input.prompt, llmProviderId: input.llmProviderId ?? null, llmSettings: input.llmSettings ?? null, metadata: input.metadata ?? null, version: 1 }).returning();

      const createdClassifier = classifier[0];

      await this.auditService.logCreate('classifier', createdClassifier.id, { id: createdClassifier.id, projectId: createdClassifier.projectId, name: createdClassifier.name, description: createdClassifier.description, prompt: createdClassifier.prompt, llmProviderId: createdClassifier.llmProviderId, llmSettings: createdClassifier.llmSettings, metadata: createdClassifier.metadata }, context?.adminId);

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
  async getClassifierById(id: string): Promise<ClassifierResponse> {
    logger.debug({ classifierId: id }, 'Fetching classifier by ID');

    try {
      const classifier = await db.query.classifiers.findFirst({ where: eq(classifiers.id, id) });

      if (!classifier) {
        throw new NotFoundError(`Classifier with id ${id} not found`);
      }

      return classifierResponseSchema.parse(classifier);
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
  async listClassifiers(params?: ListParams): Promise<ClassifierListResponse> {
    logger.debug({ params }, 'Listing classifiers');

    try {
      const conditions: SQL[] = [];
      const offset = params?.offset ?? 0;
      const limit = params?.limit ?? null;

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
          const condition = buildFilterCondition(field, filter, columnMap, logger);
          if (condition) {
            conditions.push(condition);
          }
        }
      }

      // Apply text search (searches name and description)
      if (params?.textSearch) {
        const searchTerm = `%${params.textSearch}%`;
        conditions.push(like(classifiers.name, searchTerm));
      }

      // Build order by clause
      const orderByClause = buildOrderBy(params?.orderBy, columnMap);

      // Get total count
      const totalResult = await db.query.classifiers.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
      });
      const total = totalResult.length;

      // Get paginated results
      const classifierList = await db.query.classifiers.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
        orderBy: orderByClause.length > 0 ? orderByClause : [desc(classifiers.createdAt)],
        limit: limit ?? undefined,
        offset,
      });

      return classifierListResponseSchema.parse({
        items: classifierList,
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
  async updateClassifier(id: string, input: UpdateClassifierRequest, context: RequestContext): Promise<ClassifierResponse> {
    this.requirePermission(context, PERMISSIONS.CLASSIFIER_WRITE);
    const { version: expectedVersion, ...updateData } = input;
    logger.info({ classifierId: id, expectedVersion, adminId: context?.adminId }, 'Updating classifier');

    try {
      const existingClassifier = await db.query.classifiers.findFirst({ where: eq(classifiers.id, id) });

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
      if (updateData.metadata !== undefined) updatePayload.metadata = updateData.metadata;

      const updatedClassifier = await db.update(classifiers).set(updatePayload).where(and(eq(classifiers.id, id), eq(classifiers.version, expectedVersion))).returning();

      if (updatedClassifier.length === 0) {
        throw new OptimisticLockError(`Failed to update classifier due to version conflict`);
      }

      const classifier = updatedClassifier[0];

      await this.auditService.logUpdate('classifier', classifier.id, { id: existingClassifier.id, name: existingClassifier.name, description: existingClassifier.description, prompt: existingClassifier.prompt, llmProviderId: existingClassifier.llmProviderId, llmSettings: existingClassifier.llmSettings, metadata: existingClassifier.metadata }, { id: classifier.id, name: classifier.name, description: classifier.description, prompt: classifier.prompt, llmProviderId: classifier.llmProviderId, llmSettings: classifier.llmSettings, metadata: classifier.metadata }, context?.adminId);

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
  async deleteClassifier(id: string, expectedVersion: number, context: RequestContext): Promise<void> {
    this.requirePermission(context, PERMISSIONS.CLASSIFIER_DELETE);
    logger.info({ classifierId: id, expectedVersion, adminId: context?.adminId }, 'Deleting classifier');

    try {
      const existingClassifier = await db.query.classifiers.findFirst({ where: eq(classifiers.id, id) });

      if (!existingClassifier) {
        throw new NotFoundError(`Classifier with id ${id} not found`);
      }

      if (existingClassifier.version !== expectedVersion) {
        throw new OptimisticLockError(`Classifier version mismatch. Expected ${expectedVersion}, got ${existingClassifier.version}`);
      }

      const deleted = await db.delete(classifiers).where(and(eq(classifiers.id, id), eq(classifiers.version, expectedVersion))).returning();

      if (deleted.length === 0) {
        throw new OptimisticLockError(`Failed to delete classifier due to version conflict`);
      }

      await this.auditService.logDelete('classifier', id, { id: existingClassifier.id, name: existingClassifier.name, description: existingClassifier.description, prompt: existingClassifier.prompt, llmProviderId: existingClassifier.llmProviderId, llmSettings: existingClassifier.llmSettings, metadata: existingClassifier.metadata }, context?.adminId);

      logger.info({ classifierId: id }, 'Classifier deleted successfully');
    } catch (error) {
      logger.error({ error, classifierId: id }, 'Failed to delete classifier');
      throw error;
    }
  }

  /**
   * Retrieves all audit log entries for a specific classifier
   * @param classifierId - The unique identifier of the classifier
   * @returns Array of audit log entries for the classifier
   */
  async getClassifierAuditLogs(classifierId: string): Promise<any[]> {
    logger.debug({ classifierId }, 'Fetching audit logs for classifier');

    try {
      return await this.auditService.getEntityAuditLogs('classifier', classifierId);
    } catch (error) {
      logger.error({ error, classifierId }, 'Failed to fetch classifier audit logs');
      throw error;
    }
  }
}
