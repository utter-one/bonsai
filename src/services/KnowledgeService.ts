import { injectable, inject } from 'tsyringe';
import { eq, and, like, SQL, desc, inArray } from 'drizzle-orm';
import { db } from '../db/index';
import { knowledgeSections, knowledgeCategories, knowledgeItems } from '../db/schema';
import type { CreateKnowledgeSectionRequest, UpdateKnowledgeSectionRequest, KnowledgeSectionResponse, KnowledgeSectionListResponse, CreateKnowledgeCategoryRequest, UpdateKnowledgeCategoryRequest, KnowledgeCategoryResponse, KnowledgeCategoryListResponse, CreateKnowledgeItemRequest, UpdateKnowledgeItemRequest, KnowledgeItemResponse, KnowledgeItemListResponse } from '../api/knowledge';
import type { ListParams } from '../api/common';
import { knowledgeSectionResponseSchema, knowledgeSectionListResponseSchema, knowledgeCategoryResponseSchema, knowledgeCategoryListResponseSchema, knowledgeItemResponseSchema, knowledgeItemListResponseSchema } from '../api/knowledge';
import { AuditService } from './AuditService';
import { OptimisticLockError, NotFoundError } from '../errors';
import { buildFilterCondition, buildOrderBy } from '../utils/queryBuilder';
import { logger } from '../utils/logger';
import { BaseService } from './BaseService';
import type { RequestContext } from '../types/request-context';
import { PERMISSIONS } from '../permissions';

/**
 * Service for managing knowledge base including sections, categories, and items
 * Handles full CRUD operations with audit logging and maintains relationships between entities
 */
@injectable()
export class KnowledgeService extends BaseService {
  constructor(@inject(AuditService) private readonly auditService: AuditService) {
    super();
  }

  // ============================================================
  // KNOWLEDGE SECTIONS
  // ============================================================

  /**
   * Creates a new knowledge section
   * @param input - Section creation data including id and name
   * @param context - Request context for auditing
   * @returns The created knowledge section
   */
  async createKnowledgeSection(input: CreateKnowledgeSectionRequest, context: RequestContext): Promise<KnowledgeSectionResponse> {
    this.requirePermission(context, PERMISSIONS.KNOWLEDGE_WRITE);
    logger.info({ sectionId: input.id, name: input.name, adminId: context?.adminId }, 'Creating knowledge section');

    try {
      const section = await db.insert(knowledgeSections).values({ id: input.id, name: input.name }).returning();

      const createdSection = section[0];

      await this.auditService.logCreate('knowledge_section', createdSection.id, { id: createdSection.id, name: createdSection.name }, context?.adminId);

      logger.info({ sectionId: createdSection.id }, 'Knowledge section created successfully');

      return knowledgeSectionResponseSchema.parse(createdSection);
    } catch (error) {
      logger.error({ error, sectionId: input.id }, 'Failed to create knowledge section');
      throw error;
    }
  }

  /**
   * Retrieves a knowledge section by ID
   * @param id - The unique identifier of the section
   * @returns The knowledge section if found
   * @throws {NotFoundError} When section is not found
   */
  async getKnowledgeSectionById(id: string): Promise<KnowledgeSectionResponse> {
    logger.debug({ sectionId: id }, 'Fetching knowledge section by ID');

    try {
      const section = await db.query.knowledgeSections.findFirst({ where: eq(knowledgeSections.id, id) });

      if (!section) {
        throw new NotFoundError(`Knowledge section with id ${id} not found`);
      }

      return knowledgeSectionResponseSchema.parse(section);
    } catch (error) {
      logger.error({ error, sectionId: id }, 'Failed to fetch knowledge section');
      throw error;
    }
  }

  /**
   * Lists knowledge sections with flexible filtering, sorting, and pagination
   * @param params - List parameters including filters, sorting, and pagination
   * @returns Paginated array of knowledge sections
   */
  async listKnowledgeSections(params?: ListParams): Promise<KnowledgeSectionListResponse> {
    logger.debug({ params }, 'Listing knowledge sections');

    try {
      const conditions: SQL[] = [];
      const offset = params?.offset ?? 0;
      const limit = params?.limit ?? null;

      const columnMap = {
        id: knowledgeSections.id,
        name: knowledgeSections.name,
        createdAt: knowledgeSections.createdAt,
        updatedAt: knowledgeSections.updatedAt,
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
        conditions.push(like(knowledgeSections.name, searchTerm));
      }

      const orderByClause = buildOrderBy(params?.orderBy, columnMap);

      const totalResult = await db.query.knowledgeSections.findMany({ where: conditions.length > 0 ? and(...conditions) : undefined });
      const total = totalResult.length;

      const sectionList = await db.query.knowledgeSections.findMany({ where: conditions.length > 0 ? and(...conditions) : undefined, orderBy: orderByClause.length > 0 ? orderByClause : [desc(knowledgeSections.createdAt)], limit: limit ?? undefined, offset });

      return knowledgeSectionListResponseSchema.parse({ items: sectionList, total, offset, limit });
    } catch (error) {
      logger.error({ error, params }, 'Failed to list knowledge sections');
      throw error;
    }
  }

  /**
   * Updates a knowledge section
   * @param id - The unique identifier of the section to update
   * @param input - Section update data
   * @param context - Request context for auditing
   * @returns The updated knowledge section
   * @throws {NotFoundError} When section is not found
   */
  async updateKnowledgeSection(id: string, input: UpdateKnowledgeSectionRequest, context: RequestContext): Promise<KnowledgeSectionResponse> {
    this.requirePermission(context, PERMISSIONS.KNOWLEDGE_WRITE);
    logger.info({ sectionId: id, adminId: context?.adminId }, 'Updating knowledge section');

    try {
      const existingSection = await db.query.knowledgeSections.findFirst({ where: eq(knowledgeSections.id, id) });

      if (!existingSection) {
        throw new NotFoundError(`Knowledge section with id ${id} not found`);
      }

      const updatedSection = await db.update(knowledgeSections).set({ name: input.name, updatedAt: new Date() }).where(eq(knowledgeSections.id, id)).returning();

      const section = updatedSection[0];

      await this.auditService.logUpdate('knowledge_section', section.id, { id: existingSection.id, name: existingSection.name }, { id: section.id, name: section.name }, context?.adminId);

      logger.info({ sectionId: section.id }, 'Knowledge section updated successfully');

      return knowledgeSectionResponseSchema.parse(section);
    } catch (error) {
      logger.error({ error, sectionId: id }, 'Failed to update knowledge section');
      throw error;
    }
  }

  /**
   * Deletes a knowledge section
   * @param id - The unique identifier of the section to delete
   * @param context - Request context for auditing
   * @throws {NotFoundError} When section is not found
   */
  async deleteKnowledgeSection(id: string, context: RequestContext): Promise<void> {
    this.requirePermission(context, PERMISSIONS.KNOWLEDGE_DELETE);
    logger.info({ sectionId: id, adminId: context?.adminId }, 'Deleting knowledge section');

    try {
      const existingSection = await db.query.knowledgeSections.findFirst({ where: eq(knowledgeSections.id, id) });

      if (!existingSection) {
        throw new NotFoundError(`Knowledge section with id ${id} not found`);
      }

      await db.delete(knowledgeSections).where(eq(knowledgeSections.id, id));

      await this.auditService.logDelete('knowledge_section', id, { id: existingSection.id, name: existingSection.name }, context?.adminId);

      logger.info({ sectionId: id }, 'Knowledge section deleted successfully');
    } catch (error) {
      logger.error({ error, sectionId: id }, 'Failed to delete knowledge section');
      throw error;
    }
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
  async createKnowledgeCategory(input: CreateKnowledgeCategoryRequest, context: RequestContext): Promise<KnowledgeCategoryResponse> {
    this.requirePermission(context, PERMISSIONS.KNOWLEDGE_WRITE);
    logger.info({ categoryId: input.id, name: input.name, adminId: context?.adminId }, 'Creating knowledge category');

    try {
      const category = await db.insert(knowledgeCategories).values({ id: input.id, name: input.name, promptTrigger: input.promptTrigger, knowledgeSections: input.knowledgeSections ?? [], order: input.order ?? 0, version: 1 }).returning();

      const createdCategory = category[0];

      await this.auditService.logCreate('knowledge_category', createdCategory.id, { id: createdCategory.id, name: createdCategory.name, promptTrigger: createdCategory.promptTrigger, knowledgeSections: createdCategory.knowledgeSections, order: createdCategory.order }, context?.adminId);

      logger.info({ categoryId: createdCategory.id }, 'Knowledge category created successfully');

      return knowledgeCategoryResponseSchema.parse(createdCategory);
    } catch (error) {
      logger.error({ error, categoryId: input.id }, 'Failed to create knowledge category');
      throw error;
    }
  }

  /**
   * Retrieves a knowledge category by ID with its items
   * @param id - The unique identifier of the category
   * @returns The knowledge category with related items
   * @throws {NotFoundError} When category is not found
   */
  async getKnowledgeCategoryById(id: string): Promise<KnowledgeCategoryResponse> {
    logger.debug({ categoryId: id }, 'Fetching knowledge category by ID');

    try {
      const category = await db.query.knowledgeCategories.findFirst({ where: eq(knowledgeCategories.id, id), with: { items: { orderBy: (items, { asc }) => [asc(items.order)] } } });

      if (!category) {
        throw new NotFoundError(`Knowledge category with id ${id} not found`);
      }

      return knowledgeCategoryResponseSchema.parse(category);
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
  async listKnowledgeCategories(params?: ListParams): Promise<KnowledgeCategoryListResponse> {
    logger.debug({ params }, 'Listing knowledge categories');

    try {
      const conditions: SQL[] = [];
      const offset = params?.offset ?? 0;
      const limit = params?.limit ?? null;

      const columnMap = {
        id: knowledgeCategories.id,
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
        const searchTerm = `%${params.textSearch}%`;
        conditions.push(like(knowledgeCategories.name, searchTerm));
      }

      const orderByClause = buildOrderBy(params?.orderBy, columnMap);

      const totalResult = await db.query.knowledgeCategories.findMany({ where: conditions.length > 0 ? and(...conditions) : undefined });
      const total = totalResult.length;

      const categoryList = await db.query.knowledgeCategories.findMany({ where: conditions.length > 0 ? and(...conditions) : undefined, orderBy: orderByClause.length > 0 ? orderByClause : [desc(knowledgeCategories.order)], limit: limit ?? undefined, offset, with: { items: { orderBy: (items, { asc }) => [asc(items.order)] } } });

      return knowledgeCategoryListResponseSchema.parse({ items: categoryList, total, offset, limit });
    } catch (error) {
      logger.error({ error, params }, 'Failed to list knowledge categories');
      throw error;
    }
  }

  /**
   * Updates a knowledge category using optimistic locking
   * @param id - The unique identifier of the category to update
   * @param input - Category update data (without version)
   * @param expectedVersion - The expected version number for optimistic locking
   * @param context - Request context for auditing
   * @returns The updated knowledge category
   * @throws {NotFoundError} When category is not found
   * @throws {OptimisticLockError} When version doesn't match
   */
  async updateKnowledgeCategory(id: string, input: Omit<UpdateKnowledgeCategoryRequest, 'version'>, expectedVersion: number, context: RequestContext): Promise<KnowledgeCategoryResponse> {
    this.requirePermission(context, PERMISSIONS.KNOWLEDGE_WRITE);
    logger.info({ categoryId: id, expectedVersion, adminId: context?.adminId }, 'Updating knowledge category');

    try {
      const existingCategory = await db.query.knowledgeCategories.findFirst({ where: eq(knowledgeCategories.id, id), with: { items: { orderBy: (items, { asc }) => [asc(items.order)] } } });

      if (!existingCategory) {
        throw new NotFoundError(`Knowledge category with id ${id} not found`);
      }

      if (existingCategory.version !== expectedVersion) {
        throw new OptimisticLockError(`Knowledge category version mismatch. Expected ${expectedVersion}, got ${existingCategory.version}`);
      }

      const updatedCategory = await db.update(knowledgeCategories).set({ name: input.name, promptTrigger: input.promptTrigger, knowledgeSections: input.knowledgeSections, order: input.order, version: existingCategory.version + 1, updatedAt: new Date() }).where(and(eq(knowledgeCategories.id, id), eq(knowledgeCategories.version, expectedVersion))).returning();

      if (updatedCategory.length === 0) {
        throw new OptimisticLockError(`Failed to update knowledge category due to version conflict`);
      }

      const category = await db.query.knowledgeCategories.findFirst({ where: eq(knowledgeCategories.id, id), with: { items: { orderBy: (items, { asc }) => [asc(items.order)] } } });

      await this.auditService.logUpdate('knowledge_category', id, { id: existingCategory.id, name: existingCategory.name, promptTrigger: existingCategory.promptTrigger, knowledgeSections: existingCategory.knowledgeSections, order: existingCategory.order }, { id: category!.id, name: category!.name, promptTrigger: category!.promptTrigger, knowledgeSections: category!.knowledgeSections, order: category!.order }, context?.adminId);

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
  async deleteKnowledgeCategory(id: string, expectedVersion: number, context: RequestContext): Promise<void> {
    this.requirePermission(context, PERMISSIONS.KNOWLEDGE_DELETE);
    logger.info({ categoryId: id, expectedVersion, adminId: context?.adminId }, 'Deleting knowledge category');

    try {
      const existingCategory = await db.query.knowledgeCategories.findFirst({ where: eq(knowledgeCategories.id, id) });

      if (!existingCategory) {
        throw new NotFoundError(`Knowledge category with id ${id} not found`);
      }

      if (existingCategory.version !== expectedVersion) {
        throw new OptimisticLockError(`Knowledge category version mismatch. Expected ${expectedVersion}, got ${existingCategory.version}`);
      }

      const deleted = await db.delete(knowledgeCategories).where(and(eq(knowledgeCategories.id, id), eq(knowledgeCategories.version, expectedVersion))).returning();

      if (deleted.length === 0) {
        throw new OptimisticLockError(`Failed to delete knowledge category due to version conflict`);
      }

      await this.auditService.logDelete('knowledge_category', id, { id: existingCategory.id, name: existingCategory.name, promptTrigger: existingCategory.promptTrigger, knowledgeSections: existingCategory.knowledgeSections, order: existingCategory.order }, context?.adminId);

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
  async createKnowledgeItem(input: CreateKnowledgeItemRequest, context: RequestContext): Promise<KnowledgeItemResponse> {
    this.requirePermission(context, PERMISSIONS.KNOWLEDGE_WRITE);
    logger.info({ itemId: input.id, categoryId: input.categoryId, adminId: context?.adminId }, 'Creating knowledge item');

    try {
      const item = await db.insert(knowledgeItems).values({ id: input.id, categoryId: input.categoryId, question: input.question, answer: input.answer, order: input.order ?? 0, version: 1 }).returning();

      const createdItem = item[0];

      await this.auditService.logCreate('knowledge_item', createdItem.id, { id: createdItem.id, categoryId: createdItem.categoryId, question: createdItem.question, answer: createdItem.answer, order: createdItem.order }, context?.adminId);

      logger.info({ itemId: createdItem.id }, 'Knowledge item created successfully');

      return knowledgeItemResponseSchema.parse(createdItem);
    } catch (error) {
      logger.error({ error, itemId: input.id }, 'Failed to create knowledge item');
      throw error;
    }
  }

  /**
   * Retrieves a knowledge item by ID
   * @param id - The unique identifier of the item
   * @returns The knowledge item if found
   * @throws {NotFoundError} When item is not found
   */
  async getKnowledgeItemById(id: string): Promise<KnowledgeItemResponse> {
    logger.debug({ itemId: id }, 'Fetching knowledge item by ID');

    try {
      const item = await db.query.knowledgeItems.findFirst({ where: eq(knowledgeItems.id, id) });

      if (!item) {
        throw new NotFoundError(`Knowledge item with id ${id} not found`);
      }

      return knowledgeItemResponseSchema.parse(item);
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
  async listKnowledgeItems(params?: ListParams): Promise<KnowledgeItemListResponse> {
    logger.debug({ params }, 'Listing knowledge items');

    try {
      const conditions: SQL[] = [];
      const offset = params?.offset ?? 0;
      const limit = params?.limit ?? null;

      const columnMap = {
        id: knowledgeItems.id,
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

      const totalResult = await db.query.knowledgeItems.findMany({ where: conditions.length > 0 ? and(...conditions) : undefined });
      const total = totalResult.length;

      const itemList = await db.query.knowledgeItems.findMany({ where: conditions.length > 0 ? and(...conditions) : undefined, orderBy: orderByClause.length > 0 ? orderByClause : [desc(knowledgeItems.order)], limit: limit ?? undefined, offset });

      return knowledgeItemListResponseSchema.parse({ items: itemList, total, offset, limit });
    } catch (error) {
      logger.error({ error, params }, 'Failed to list knowledge items');
      throw error;
    }
  }

  /**
   * Updates a knowledge item using optimistic locking
   * @param id - The unique identifier of the item to update
   * @param input - Item update data (without version)
   * @param expectedVersion - The expected version number for optimistic locking
   * @param context - Request context for auditing
   * @returns The updated knowledge item
   * @throws {NotFoundError} When item is not found
   * @throws {OptimisticLockError} When version doesn't match
   */
  async updateKnowledgeItem(id: string, input: Omit<UpdateKnowledgeItemRequest, 'version'>, expectedVersion: number, context: RequestContext): Promise<KnowledgeItemResponse> {
    this.requirePermission(context, PERMISSIONS.KNOWLEDGE_WRITE);
    logger.info({ itemId: id, expectedVersion, adminId: context?.adminId }, 'Updating knowledge item');

    try {
      const existingItem = await db.query.knowledgeItems.findFirst({ where: eq(knowledgeItems.id, id) });

      if (!existingItem) {
        throw new NotFoundError(`Knowledge item with id ${id} not found`);
      }

      if (existingItem.version !== expectedVersion) {
        throw new OptimisticLockError(`Knowledge item version mismatch. Expected ${expectedVersion}, got ${existingItem.version}`);
      }

      const updatedItem = await db.update(knowledgeItems).set({ categoryId: input.categoryId, question: input.question, answer: input.answer, order: input.order, version: existingItem.version + 1, updatedAt: new Date() }).where(and(eq(knowledgeItems.id, id), eq(knowledgeItems.version, expectedVersion))).returning();

      if (updatedItem.length === 0) {
        throw new OptimisticLockError(`Failed to update knowledge item due to version conflict`);
      }

      const item = updatedItem[0];

      await this.auditService.logUpdate('knowledge_item', item.id, { id: existingItem.id, categoryId: existingItem.categoryId, question: existingItem.question, answer: existingItem.answer, order: existingItem.order }, { id: item.id, categoryId: item.categoryId, question: item.question, answer: item.answer, order: item.order }, context?.adminId);

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
  async deleteKnowledgeItem(id: string, expectedVersion: number, context: RequestContext): Promise<void> {
    this.requirePermission(context, PERMISSIONS.KNOWLEDGE_DELETE);
    logger.info({ itemId: id, expectedVersion, adminId: context?.adminId }, 'Deleting knowledge item');

    try {
      const existingItem = await db.query.knowledgeItems.findFirst({ where: eq(knowledgeItems.id, id) });

      if (!existingItem) {
        throw new NotFoundError(`Knowledge item with id ${id} not found`);
      }

      if (existingItem.version !== expectedVersion) {
        throw new OptimisticLockError(`Knowledge item version mismatch. Expected ${expectedVersion}, got ${existingItem.version}`);
      }

      const deleted = await db.delete(knowledgeItems).where(and(eq(knowledgeItems.id, id), eq(knowledgeItems.version, expectedVersion))).returning();

      if (deleted.length === 0) {
        throw new OptimisticLockError(`Failed to delete knowledge item due to version conflict`);
      }

      await this.auditService.logDelete('knowledge_item', id, { id: existingItem.id, categoryId: existingItem.categoryId, question: existingItem.question, answer: existingItem.answer, order: existingItem.order }, context?.adminId);

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
  async getItemsByCategory(categoryId: string): Promise<KnowledgeItemResponse[]> {
    logger.debug({ categoryId }, 'Fetching items by category');

    try {
      const items = await db.query.knowledgeItems.findMany({ where: eq(knowledgeItems.categoryId, categoryId), orderBy: (items, { asc }) => [asc(items.order)] });

      return items.map(item => knowledgeItemResponseSchema.parse(item));
    } catch (error) {
      logger.error({ error, categoryId }, 'Failed to fetch items by category');
      throw error;
    }
  }

  /**
   * Gets categories for specific knowledge sections
   * @param sectionIds - Array of section IDs
   * @returns Array of knowledge categories with their items
   */
  async getCategoriesBySections(sectionIds: string[]): Promise<KnowledgeCategoryResponse[]> {
    logger.debug({ sectionIds }, 'Fetching categories by sections');

    try {
      const allCategories = await db.query.knowledgeCategories.findMany({ with: { items: { orderBy: (items, { asc }) => [asc(items.order)] } } });

      const filteredCategories = allCategories.filter(category => {
        const categorySections = category.knowledgeSections as string[];
        return categorySections.some(section => sectionIds.includes(section));
      });

      return filteredCategories.map(category => knowledgeCategoryResponseSchema.parse(category));
    } catch (error) {
      logger.error({ error, sectionIds }, 'Failed to fetch categories by sections');
      throw error;
    }
  }
}
