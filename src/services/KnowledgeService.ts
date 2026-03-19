import { injectable, inject } from 'tsyringe';
import { eq, ilike, or, inArray, and, like, SQL, desc, sql } from 'drizzle-orm';
import { parseTextSearch } from '../utils/textSearch';
import { db } from '../db/index';
import { knowledgeCategories, knowledgeItems } from '../db/schema';
import type { CreateKnowledgeCategoryRequest, UpdateKnowledgeCategoryRequest, KnowledgeCategoryResponse, KnowledgeCategoryListResponse, CreateKnowledgeItemRequest, UpdateKnowledgeItemRequest, KnowledgeItemResponse, KnowledgeItemListResponse } from '../http/contracts/knowledge';
import type { ListParams } from '../http/contracts/common';
import { knowledgeCategoryResponseSchema, knowledgeCategoryListResponseSchema, knowledgeItemResponseSchema, knowledgeItemListResponseSchema } from '../http/contracts/knowledge';
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
 * Service for managing knowledge base including categories, and items
 * Handles full CRUD operations with audit logging and maintains relationships between entities
 */
@injectable()
export class KnowledgeService extends BaseService {
  constructor(@inject(AuditService) private readonly auditService: AuditService) {
    super();
  }

  // ============================================================
  // KNOWLEDGE CATEGORIES
  // ============================================================

  /**
   * Creates a new knowledge category
   * @param input - Category creation data
   * @param context - Request context for auditing
   * @returns The created knowledge category
   */
  async createKnowledgeCategory(projectId: string, input: CreateKnowledgeCategoryRequest, context: RequestContext): Promise<KnowledgeCategoryResponse> {
    this.requirePermission(context, PERMISSIONS.KNOWLEDGE_WRITE);
    await this.requireProjectNotArchived(projectId);
    const categoryId = input.id ?? generateId(ID_PREFIXES.KNOWLEDGE_CATEGORY);
    logger.info({ categoryId, projectId, name: input.name, operatorId: context?.operatorId }, 'Creating knowledge category');

    try {
      const category = await db.insert(knowledgeCategories).values({ id: categoryId, projectId, name: input.name, promptTrigger: input.promptTrigger, tags: input.tags ?? [], order: input.order ?? 0, version: 1 }).returning();

      const createdCategory = category[0];

      await this.auditService.logCreate('knowledge_category', createdCategory.id, createdCategory, context?.operatorId);

      logger.info({ categoryId: createdCategory.id }, 'Knowledge category created successfully');

      return knowledgeCategoryResponseSchema.parse(createdCategory);
    } catch (error) {
      logger.error({ error, categoryId }, 'Failed to create knowledge category');
      throw error;
    }
  }

  /**
   * Retrieves a knowledge category by ID with its items
   * @param id - The unique identifier of the category
   * @returns The knowledge category with related items
   * @throws {NotFoundError} When category is not found
   */
  async getKnowledgeCategoryById(projectId: string, id: string): Promise<KnowledgeCategoryResponse> {
    logger.debug({ categoryId: id }, 'Fetching knowledge category by ID');

    try {
      const category = await db.query.knowledgeCategories.findFirst({ where: and(eq(knowledgeCategories.projectId, projectId), eq(knowledgeCategories.id, id)), with: { items: { orderBy: (items, { asc }) => [asc(items.order)] } } });

      if (!category) {
        throw new NotFoundError(`Knowledge category with id ${id} not found`);
      }

      const archived = !(await this.isProjectActive(projectId));
      return knowledgeCategoryResponseSchema.parse({ ...category, archived });
    } catch (error) {
      logger.error({ error, categoryId: id }, 'Failed to fetch knowledge category');
      throw error;
    }
  }

  /**
   * Lists knowledge categories with optional filtering, sorting, and pagination
   * @param params - List parameters
   * @returns Paginated array of knowledge categories with their items
   */
  async listKnowledgeCategories(projectId: string, params?: ListParams): Promise<KnowledgeCategoryListResponse> {
    logger.debug({ params }, 'Listing knowledge categories');

    try {
      const conditions: SQL[] = [eq(knowledgeCategories.projectId, projectId)];
      const offset = params?.offset ?? 0;
      const limit = normalizeListLimit(params?.limit);

      const columnMap = {
        id: knowledgeCategories.id,
        projectId: knowledgeCategories.projectId,
        name: knowledgeCategories.name,
        order: knowledgeCategories.order,
        version: knowledgeCategories.version,
        createdAt: knowledgeCategories.createdAt,
        updatedAt: knowledgeCategories.updatedAt,
      };

      if (params?.filters) {
        for (const [field, filter] of Object.entries(params.filters)) {
          const condition = buildFilterCondition(field, filter, columnMap, logger);
          if (condition) {
            conditions.push(condition);
          }
        }
      }

      if (params?.textSearch) {
        const parsed = parseTextSearch(params.textSearch);
        if (parsed.type === 'tag') {
          conditions.push(sql`${knowledgeCategories.tags} @> ${JSON.stringify([parsed.value])}::jsonb`);
        } else {
          const searchTerm = `%${parsed.value}%`;
          const itemSubQuery = db.select({ id: knowledgeItems.categoryId }).from(knowledgeItems).where(and(eq(knowledgeItems.projectId, projectId), or(ilike(knowledgeItems.question, searchTerm), ilike(knowledgeItems.answer, searchTerm))!));
          conditions.push(or(ilike(knowledgeCategories.name, searchTerm), ilike(knowledgeCategories.promptTrigger, searchTerm), inArray(knowledgeCategories.id, itemSubQuery))!);
        }
      }

      const orderByClause = buildOrderBy(params?.orderBy, columnMap);
      const whereCondition = conditions.length > 0 ? and(...conditions) : undefined;

      const total = await countRows(knowledgeCategories, whereCondition);

      const categoryList = await db.query.knowledgeCategories.findMany({ where: whereCondition, orderBy: orderByClause.length > 0 ? orderByClause : [desc(knowledgeCategories.order)], limit, offset, with: { items: { orderBy: (items, { asc }) => [asc(items.order)] } } });

      const archived = !(await this.isProjectActive(projectId));
      return knowledgeCategoryListResponseSchema.parse({ items: categoryList.map(c => ({ ...c, archived })), total, offset, limit });
    } catch (error) {
      logger.error({ error, params }, 'Failed to list knowledge categories');
      throw error;
    }
  }

  /**
   * Updates a knowledge category using optimistic locking
   * @param id - The unique identifier of the category to update
   * @param input - Category update data (with version)
   * @param context - Request context for auditing
   * @returns The updated knowledge category
   * @throws {NotFoundError} When category is not found
   * @throws {OptimisticLockError} When version doesn't match
   */
  async updateKnowledgeCategory(projectId: string, id: string, input: UpdateKnowledgeCategoryRequest, context: RequestContext): Promise<KnowledgeCategoryResponse> {
    this.requirePermission(context, PERMISSIONS.KNOWLEDGE_WRITE);
    await this.requireProjectNotArchived(projectId);
    const { version: expectedVersion, ...updateData } = input;
    logger.info({ categoryId: id, expectedVersion, operatorId: context?.operatorId }, 'Updating knowledge category');

    try {
      const existingCategory = await db.query.knowledgeCategories.findFirst({ where: and(eq(knowledgeCategories.projectId, projectId), eq(knowledgeCategories.id, id)), with: { items: { orderBy: (items, { asc }) => [asc(items.order)] } } });

      if (!existingCategory) {
        throw new NotFoundError(`Knowledge category with id ${id} not found`);
      }

      if (existingCategory.version !== expectedVersion) {
        throw new OptimisticLockError(`Knowledge category version mismatch. Expected ${expectedVersion}, got ${existingCategory.version}`);
      }

      const updatedCategory = await db.update(knowledgeCategories).set({ name: updateData.name, promptTrigger: updateData.promptTrigger, tags: updateData.tags, order: updateData.order, version: existingCategory.version + 1, updatedAt: new Date() }).where(and(eq(knowledgeCategories.projectId, projectId), eq(knowledgeCategories.id, id), eq(knowledgeCategories.version, expectedVersion))).returning();

      if (updatedCategory.length === 0) {
        throw new OptimisticLockError(`Failed to update knowledge category due to version conflict`);
      }

      const category = await db.query.knowledgeCategories.findFirst({ where: eq(knowledgeCategories.id, id), with: { items: { orderBy: (items, { asc }) => [asc(items.order)] } } });

      await this.auditService.logUpdate('knowledge_category', id, existingCategory, category!, context?.operatorId, projectId);

      logger.info({ categoryId: category!.id, newVersion: category!.version }, 'Knowledge category updated successfully');

      return knowledgeCategoryResponseSchema.parse(category);
    } catch (error) {
      logger.error({ error, categoryId: id }, 'Failed to update knowledge category');
      throw error;
    }
  }

  /**
   * Deletes a knowledge category using optimistic locking
   * @param id - The unique identifier of the category to delete
   * @param expectedVersion - The expected version number for optimistic locking
   * @param context - Request context for auditing
   * @throws {NotFoundError} When category is not found
   * @throws {OptimisticLockError} When version doesn't match
   */
  async deleteKnowledgeCategory(projectId: string, id: string, expectedVersion: number, context: RequestContext): Promise<void> {
    this.requirePermission(context, PERMISSIONS.KNOWLEDGE_DELETE);
    await this.requireProjectNotArchived(projectId);
    logger.info({ categoryId: id, expectedVersion, operatorId: context?.operatorId }, 'Deleting knowledge category');

    try {
      const existingCategory = await db.query.knowledgeCategories.findFirst({ where: and(eq(knowledgeCategories.projectId, projectId), eq(knowledgeCategories.id, id)) });

      if (!existingCategory) {
        throw new NotFoundError(`Knowledge category with id ${id} not found`);
      }

      if (existingCategory.version !== expectedVersion) {
        throw new OptimisticLockError(`Knowledge category version mismatch. Expected ${expectedVersion}, got ${existingCategory.version}`);
      }

      const deleted = await db.delete(knowledgeCategories).where(and(eq(knowledgeCategories.projectId, projectId), eq(knowledgeCategories.id, id), eq(knowledgeCategories.version, expectedVersion))).returning();

      if (deleted.length === 0) {
        throw new OptimisticLockError(`Failed to delete knowledge category due to version conflict`);
      }

      await this.auditService.logDelete('knowledge_category', id, existingCategory, context?.operatorId, projectId);

      logger.info({ categoryId: id }, 'Knowledge category deleted successfully');
    } catch (error) {
      logger.error({ error, categoryId: id }, 'Failed to delete knowledge category');
      throw error;
    }
  }

  // ============================================================
  // KNOWLEDGE ITEMS
  // ============================================================

  /**
   * Creates a new knowledge item
   * @param input - Item creation data
   * @param context - Request context for auditing
   * @returns The created knowledge item
   */
  async createKnowledgeItem(projectId: string, input: CreateKnowledgeItemRequest, context: RequestContext): Promise<KnowledgeItemResponse> {
    this.requirePermission(context, PERMISSIONS.KNOWLEDGE_WRITE);
    await this.requireProjectNotArchived(projectId);
    const itemId = input.id ?? generateId(ID_PREFIXES.KNOWLEDGE_ITEM);
    logger.info({ itemId, categoryId: input.categoryId, operatorId: context?.operatorId }, 'Creating knowledge item');

    try {
      const item = await db.insert(knowledgeItems).values({ id: itemId, projectId, categoryId: input.categoryId, question: input.question, answer: input.answer, order: input.order ?? 0, version: 1 }).returning();

      const createdItem = item[0];

      await this.auditService.logCreate('knowledge_item', createdItem.id, createdItem, context?.operatorId, projectId);

      logger.info({ itemId: createdItem.id }, 'Knowledge item created successfully');

      return knowledgeItemResponseSchema.parse(createdItem);
    } catch (error) {
      logger.error({ error, itemId }, 'Failed to create knowledge item');
      throw error;
    }
  }

  /**
   * Retrieves a knowledge item by ID
   * @param id - The unique identifier of the item
   * @returns The knowledge item if found
   * @throws {NotFoundError} When item is not found
   */
  async getKnowledgeItemById(projectId: string, id: string): Promise<KnowledgeItemResponse> {
    logger.debug({ itemId: id }, 'Fetching knowledge item by ID');

    try {
      const item = await db.query.knowledgeItems.findFirst({ where: and(eq(knowledgeItems.projectId, projectId), eq(knowledgeItems.id, id)) });

      if (!item) {
        throw new NotFoundError(`Knowledge item with id ${id} not found`);
      }

      const archived = !(await this.isProjectActive(projectId));
      return knowledgeItemResponseSchema.parse({ ...item, archived });
    } catch (error) {
      logger.error({ error, itemId: id }, 'Failed to fetch knowledge item');
      throw error;
    }
  }

  /**
   * Lists knowledge items with optional filtering by category
   * @param params - List parameters with optional categoryId filter
   * @returns Paginated array of knowledge items
   */
  async listKnowledgeItems(projectId: string, params?: ListParams): Promise<KnowledgeItemListResponse> {
    logger.debug({ params }, 'Listing knowledge items');

    try {
      const conditions: SQL[] = [eq(knowledgeItems.projectId, projectId)];
      const offset = params?.offset ?? 0;
      const limit = normalizeListLimit(params?.limit);

      const columnMap = {
        id: knowledgeItems.id,
        projectId: knowledgeItems.projectId,
        categoryId: knowledgeItems.categoryId,
        question: knowledgeItems.question,
        answer: knowledgeItems.answer,
        order: knowledgeItems.order,
        version: knowledgeItems.version,
        createdAt: knowledgeItems.createdAt,
        updatedAt: knowledgeItems.updatedAt,
      };

      if (params?.filters) {
        for (const [field, filter] of Object.entries(params.filters)) {
          const condition = buildFilterCondition(field, filter, columnMap, logger);
          if (condition) {
            conditions.push(condition);
          }
        }
      }

      if (params?.textSearch) {
        const searchTerm = `%${params.textSearch}%`;
        conditions.push(like(knowledgeItems.question, searchTerm));
      }

      const orderByClause = buildOrderBy(params?.orderBy, columnMap);
      const whereCondition = conditions.length > 0 ? and(...conditions) : undefined;

      const total = await countRows(knowledgeItems, whereCondition);

      const itemList = await db.query.knowledgeItems.findMany({ where: whereCondition, orderBy: orderByClause.length > 0 ? orderByClause : [desc(knowledgeItems.order)], limit, offset });

      const archived = !(await this.isProjectActive(projectId));
      return knowledgeItemListResponseSchema.parse({ items: itemList.map(i => ({ ...i, archived })), total, offset, limit });
    } catch (error) {
      logger.error({ error, params }, 'Failed to list knowledge items');
      throw error;
    }
  }

  /**
   * Updates a knowledge item using optimistic locking
   * @param id - The unique identifier of the item to update
   * @param input - Item update data (with version)
   * @param context - Request context for auditing
   * @returns The updated knowledge item
   * @throws {NotFoundError} When item is not found
   * @throws {OptimisticLockError} When version doesn't match
   */
  async updateKnowledgeItem(projectId: string, id: string, input: UpdateKnowledgeItemRequest, context: RequestContext): Promise<KnowledgeItemResponse> {
    this.requirePermission(context, PERMISSIONS.KNOWLEDGE_WRITE);
    await this.requireProjectNotArchived(projectId);
    const { version: expectedVersion, ...updateData } = input;
    logger.info({ itemId: id, expectedVersion, operatorId: context?.operatorId }, 'Updating knowledge item');

    try {
      const existingItem = await db.query.knowledgeItems.findFirst({ where: and(eq(knowledgeItems.projectId, projectId), eq(knowledgeItems.id, id)) });

      if (!existingItem) {
        throw new NotFoundError(`Knowledge item with id ${id} not found`);
      }

      if (existingItem.version !== expectedVersion) {
        throw new OptimisticLockError(`Knowledge item version mismatch. Expected ${expectedVersion}, got ${existingItem.version}`);
      }

      const updatedItem = await db.update(knowledgeItems).set({ categoryId: updateData.categoryId, question: updateData.question, answer: updateData.answer, order: updateData.order, version: existingItem.version + 1, updatedAt: new Date() }).where(and(eq(knowledgeItems.projectId, projectId), eq(knowledgeItems.id, id), eq(knowledgeItems.version, expectedVersion))).returning();

      if (updatedItem.length === 0) {
        throw new OptimisticLockError(`Failed to update knowledge item due to version conflict`);
      }

      const item = updatedItem[0];

      await this.auditService.logUpdate('knowledge_item', item.id, existingItem, item, context?.operatorId, projectId);

      logger.info({ itemId: item.id, newVersion: item.version }, 'Knowledge item updated successfully');

      return knowledgeItemResponseSchema.parse(item);
    } catch (error) {
      logger.error({ error, itemId: id }, 'Failed to update knowledge item');
      throw error;
    }
  }

  /**
   * Deletes a knowledge item using optimistic locking
   * @param id - The unique identifier of the item to delete
   * @param expectedVersion - The expected version number for optimistic locking
   * @param context - Request context for auditing
   * @throws {NotFoundError} When item is not found
   * @throws {OptimisticLockError} When version doesn't match
   */
  async deleteKnowledgeItem(projectId: string, id: string, expectedVersion: number, context: RequestContext): Promise<void> {
    this.requirePermission(context, PERMISSIONS.KNOWLEDGE_DELETE);
    await this.requireProjectNotArchived(projectId);
    logger.info({ itemId: id, expectedVersion, operatorId: context?.operatorId }, 'Deleting knowledge item');

    try {
      const existingItem = await db.query.knowledgeItems.findFirst({ where: and(eq(knowledgeItems.projectId, projectId), eq(knowledgeItems.id, id)) });

      if (!existingItem) {
        throw new NotFoundError(`Knowledge item with id ${id} not found`);
      }

      if (existingItem.version !== expectedVersion) {
        throw new OptimisticLockError(`Knowledge item version mismatch. Expected ${expectedVersion}, got ${existingItem.version}`);
      }

      const deleted = await db.delete(knowledgeItems).where(and(eq(knowledgeItems.projectId, projectId), eq(knowledgeItems.id, id), eq(knowledgeItems.version, expectedVersion))).returning();

      if (deleted.length === 0) {
        throw new OptimisticLockError(`Failed to delete knowledge item due to version conflict`);
      }

      await this.auditService.logDelete('knowledge_item', id, existingItem, context?.operatorId, projectId);

      logger.info({ itemId: id }, 'Knowledge item deleted successfully');
    } catch (error) {
      logger.error({ error, itemId: id }, 'Failed to delete knowledge item');
      throw error;
    }
  }

  /**
   * Gets items for a specific knowledge category
   * @param categoryId - The unique identifier of the category
   * @returns Array of knowledge items in the category
   */
  async getItemsByCategory(projectId: string, categoryId: string): Promise<KnowledgeItemResponse[]> {
    logger.debug({ categoryId }, 'Fetching items by category');

    try {
      const items = await db.query.knowledgeItems.findMany({ where: and(eq(knowledgeItems.projectId, projectId), eq(knowledgeItems.categoryId, categoryId)), orderBy: (items, { asc }) => [asc(items.order)] });

      return items.map(item => knowledgeItemResponseSchema.parse(item));
    } catch (error) {
      logger.error({ error, categoryId }, 'Failed to fetch items by category');
      throw error;
    }
  }

  /**
   * Gets categories for specific knowledge tags
   * @param tags - Array of section IDs
   * @returns Array of knowledge categories with their items
   */
  async getCategoriesByTags(projectId: string, tags: string[]): Promise<KnowledgeCategoryResponse[]> {
    logger.debug({ tagIds: tags, projectId }, 'Fetching categories by tags');

    try {
      const allCategories = await db.query.knowledgeCategories.findMany({ where: eq(knowledgeCategories.projectId, projectId), with: { items: { orderBy: (items, { asc }) => [asc(items.order)] } } });

      // TODO: make it more efficient by doing filtering in the database instead of in memory

      const filteredCategories = allCategories.filter(category => {
        const categoryTags = category.tags as string[];
        return categoryTags.some(tag => tags.includes(tag));
      });

      return filteredCategories.map(category => knowledgeCategoryResponseSchema.parse(category));
    } catch (error) {
      logger.error({ error, tagIds: tags }, 'Failed to fetch categories by tags');
      throw error;
    }
  }

  /**
   * Retrieves all audit log entries for a specific knowledge category
   * @param categoryId - The unique identifier of the knowledge category
   * @returns Array of audit log entries for the knowledge category
   */
  async getKnowledgeCategoryAuditLogs(categoryId: string): Promise<any[]> {
    logger.debug({ categoryId }, 'Fetching audit logs for knowledge category');

    try {
      return await this.auditService.getEntityAuditLogs('knowledge_category', categoryId);
    } catch (error) {
      logger.error({ error, categoryId }, 'Failed to fetch knowledge category audit logs');
      throw error;
    }
  }

  /**
   * Retrieves all audit log entries for a specific knowledge item
   * @param itemId - The unique identifier of the knowledge item
   * @returns Array of audit log entries for the knowledge item
   */
  async getKnowledgeItemAuditLogs(itemId: string): Promise<any[]> {
    logger.debug({ itemId }, 'Fetching audit logs for knowledge item');

    try {
      return await this.auditService.getEntityAuditLogs('knowledge_item', itemId);
    } catch (error) {
      logger.error({ error, itemId }, 'Failed to fetch knowledge item audit logs');
      throw error;
    }
  }
}
