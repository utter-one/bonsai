import { injectable, inject } from 'tsyringe';
import { eq, and, or, SQL, desc, sql, ilike, isNull, isNotNull } from 'drizzle-orm';
import { buildTextSearchCondition } from '../utils/textSearch';
import { db } from '../db/index';
import { quickPrompts } from '../db/schema';
import type { CreateQuickPromptRequest, CreateProjectQuickPromptRequest, UpdateQuickPromptRequest, QuickPromptResponse, QuickPromptListResponse, CloneQuickPromptRequest } from '../http/contracts/quickPrompt';
import type { ListParams } from '../http/contracts/common';
import { quickPromptResponseSchema, quickPromptListResponseSchema } from '../http/contracts/quickPrompt';
import { AuditService } from './AuditService';
import { OptimisticLockError, NotFoundError, ForbiddenError } from '../errors';
import { buildFilterCondition, buildOrderBy } from '../utils/queryBuilder';
import { countRows, normalizeListLimit } from '../utils/pagination';
import { logger } from '../utils/logger';
import { BaseService } from './BaseService';
import type { RequestContext } from './RequestContext';
import { PERMISSIONS } from '../permissions';
import { generateId, ID_PREFIXES } from '../utils/idGenerator';

/** Drizzle transaction type, inferred to avoid driver-specific imports. */
type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Service for managing quick prompts with CRUD, visibility filtering, and system seeding.
 */
@injectable()
export class QuickPromptService extends BaseService {
  constructor(@inject(AuditService) private readonly auditService: AuditService) {
    super();
  }

  /**
   * Creates a new global quick prompt.
   */
  async createQuickPrompt(input: CreateQuickPromptRequest, context: RequestContext): Promise<QuickPromptResponse> {
    this.requirePermission(context, PERMISSIONS.QUICK_PROMPT_WRITE);
    const promptId = input.id ?? generateId(ID_PREFIXES.QUICK_PROMPT);
    logger.info({ promptId, operatorId: context.operatorId }, 'Creating global quick prompt');

    try {
      const result = await db.insert(quickPrompts).values({
        id: promptId,
        projectId: null,
        categoryId: input.categoryId,
        ownerId: context.operatorId,
        name: input.name,
        description: input.description ?? null,
        content: input.content,
        tags: input.tags ?? [],
        isPublic: input.isPublic ?? true,
        isSystem: false,
        version: 1,
      }).returning();

      const created = result[0];
      await this.auditService.logCreate('quick_prompt', created.id, created, context.operatorId);
      logger.info({ promptId: created.id }, 'Global quick prompt created successfully');
      return quickPromptResponseSchema.parse(created);
    } catch (error) {
      logger.error({ error, promptId }, 'Failed to create global quick prompt');
      throw error;
    }
  }

  /**
   * Creates a new project-scoped quick prompt.
   */
  async createProjectQuickPrompt(projectId: string, input: CreateProjectQuickPromptRequest, context: RequestContext): Promise<QuickPromptResponse> {
    this.requirePermission(context, PERMISSIONS.QUICK_PROMPT_WRITE);
    await this.requireProjectNotArchived(projectId);
    const promptId = input.id ?? generateId(ID_PREFIXES.QUICK_PROMPT);
    logger.info({ promptId, projectId, operatorId: context.operatorId }, 'Creating project quick prompt');

    try {
      const result = await db.insert(quickPrompts).values({
        id: promptId,
        projectId,
        categoryId: input.categoryId,
        ownerId: context.operatorId,
        name: input.name,
        description: input.description ?? null,
        content: input.content,
        tags: input.tags ?? [],
        isPublic: input.isPublic ?? true,
        isSystem: false,
        version: 1,
      }).returning();

      const created = result[0];
      await this.auditService.logCreate('quick_prompt', created.id, created, context.operatorId, projectId);
      logger.info({ promptId: created.id, projectId }, 'Project quick prompt created successfully');
      return quickPromptResponseSchema.parse(created);
    } catch (error) {
      logger.error({ error, promptId, projectId }, 'Failed to create project quick prompt');
      throw error;
    }
  }

  /**
   * Retrieves a quick prompt by ID.
   * @param projectId - If provided, validates the prompt belongs to the project
   */
  async getQuickPromptById(id: string, context: RequestContext, projectId?: string): Promise<QuickPromptResponse> {
    this.requirePermission(context, PERMISSIONS.QUICK_PROMPT_READ);
    logger.debug({ promptId: id, projectId }, 'Fetching quick prompt by ID');

    try {
      const where = projectId
        ? and(eq(quickPrompts.id, id), eq(quickPrompts.projectId, projectId))
        : eq(quickPrompts.id, id);

      const prompt = await db.query.quickPrompts.findFirst({ where });

      if (!prompt) {
        throw new NotFoundError(`Quick prompt with id ${id} not found`);
      }

      if (!this.isVisible(prompt, context.operatorId)) {
        throw new NotFoundError(`Quick prompt with id ${id} not found`);
      }

      return quickPromptResponseSchema.parse(prompt);
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      logger.error({ error, promptId: id }, 'Failed to fetch quick prompt');
      throw error;
    }
  }

  /**
   * Lists quick prompts with filtering, visibility, and pagination.
   * @param projectId - If provided, lists project-scoped prompts; otherwise global
   */
  async listQuickPrompts(projectId: string | undefined, context: RequestContext, params?: ListParams): Promise<QuickPromptListResponse> {
    this.requirePermission(context, PERMISSIONS.QUICK_PROMPT_READ);
    logger.debug({ projectId, params }, 'Listing quick prompts');

    try {
      const conditions: SQL[] = [];
      const offset = params?.offset ?? 0;
      const limit = normalizeListLimit(params?.limit);

      if (projectId) {
        conditions.push(eq(quickPrompts.projectId, projectId));
      } else {
        conditions.push(isNull(quickPrompts.projectId));
      }

      // Visibility: public items + owner's personal items + system items
      conditions.push(or(
        eq(quickPrompts.isPublic, true),
        eq(quickPrompts.ownerId, context.operatorId),
        eq(quickPrompts.isSystem, true),
      ));

      const columnMap = {
        id: quickPrompts.id,
        projectId: quickPrompts.projectId,
        categoryId: quickPrompts.categoryId,
        ownerId: quickPrompts.ownerId,
        name: quickPrompts.name,
        content: quickPrompts.content,
        isPublic: quickPrompts.isPublic,
        isSystem: quickPrompts.isSystem,
        version: quickPrompts.version,
        createdAt: quickPrompts.createdAt,
        updatedAt: quickPrompts.updatedAt,
      };

      if (params?.filters) {
        for (const [field, filter] of Object.entries(params.filters)) {
          if (field === 'tags') {
            const tagsArray = Array.isArray(filter) ? filter as string[] : [filter as string];
            conditions.push(sql`${quickPrompts.tags} @> ${JSON.stringify(tagsArray)}::jsonb`);
            continue;
          }
          const condition = buildFilterCondition(field, filter, columnMap, logger);
          if (condition) {
            conditions.push(condition);
          }
        }
      }

      if (params?.textSearch) {
        const searchCondition = buildTextSearchCondition(params.textSearch, [quickPrompts.name, quickPrompts.content, quickPrompts.description], undefined);
        if (searchCondition) conditions.push(searchCondition);
      }

      const orderByClause = buildOrderBy(params?.orderBy, columnMap);
      const whereCondition = conditions.length > 0 ? and(...conditions) : undefined;

      const total = await countRows(quickPrompts, whereCondition);

      const list = await db.query.quickPrompts.findMany({
        where: whereCondition,
        orderBy: orderByClause.length > 0 ? orderByClause : [desc(quickPrompts.createdAt)],
        limit,
        offset,
      });

      return quickPromptListResponseSchema.parse({
        items: list,
        total,
        offset,
        limit,
      });
    } catch (error) {
      logger.error({ error, projectId, params }, 'Failed to list quick prompts');
      throw error;
    }
  }

  /**
   * Updates a quick prompt with optimistic locking.
   * @param projectId - If provided, validates the prompt belongs to the project and checks archive status
   */
  async updateQuickPrompt(id: string, input: UpdateQuickPromptRequest, context: RequestContext, projectId?: string): Promise<QuickPromptResponse> {
    this.requirePermission(context, PERMISSIONS.QUICK_PROMPT_WRITE);
    if (projectId) await this.requireProjectNotArchived(projectId);
    const { version: expectedVersion, ...updateData } = input;
    logger.info({ promptId: id, expectedVersion, operatorId: context.operatorId }, 'Updating quick prompt');

    try {
      const where = projectId
        ? and(eq(quickPrompts.id, id), eq(quickPrompts.projectId, projectId))
        : eq(quickPrompts.id, id);

      const existing = await db.query.quickPrompts.findFirst({ where });

      if (!existing) {
        throw new NotFoundError(`Quick prompt with id ${id} not found`);
      }

      if (existing.isSystem) {
        throw new ForbiddenError('System prompts cannot be modified');
      }

      if (existing.ownerId !== context.operatorId) {
        throw new ForbiddenError('Only the owner can modify this prompt');
      }

      if (existing.version !== expectedVersion) {
        throw new OptimisticLockError(`Quick prompt version mismatch. Expected ${expectedVersion}, got ${existing.version}`);
      }

      const updatePayload: any = { version: existing.version + 1, updatedAt: new Date() };
      if (updateData.categoryId !== undefined) updatePayload.categoryId = updateData.categoryId;
      if (updateData.name !== undefined) updatePayload.name = updateData.name;
      if (updateData.description !== undefined) updatePayload.description = updateData.description;
      if (updateData.content !== undefined) updatePayload.content = updateData.content;
      if (updateData.tags !== undefined) updatePayload.tags = updateData.tags;
      if (updateData.isPublic !== undefined) updatePayload.isPublic = updateData.isPublic;

      const updated = await db.update(quickPrompts)
        .set(updatePayload)
        .where(and(
          eq(quickPrompts.id, id),
          eq(quickPrompts.version, expectedVersion),
        ))
        .returning();

      if (updated.length === 0) {
        throw new OptimisticLockError(`Failed to update quick prompt due to version conflict`);
      }

      const prompt = updated[0];
      await this.auditService.logUpdate('quick_prompt', prompt.id, existing, prompt, context.operatorId, prompt.projectId ?? undefined);
      logger.info({ promptId: prompt.id, newVersion: prompt.version }, 'Quick prompt updated successfully');
      return quickPromptResponseSchema.parse(prompt);
    } catch (error) {
      if (error instanceof NotFoundError || error instanceof ForbiddenError || error instanceof OptimisticLockError) throw error;
      logger.error({ error, promptId: id }, 'Failed to update quick prompt');
      throw error;
    }
  }

  /**
   * Deletes a quick prompt with optimistic locking.
   * @param projectId - If provided, validates the prompt belongs to the project
   */
  async deleteQuickPrompt(id: string, expectedVersion: number, context: RequestContext, projectId?: string): Promise<void> {
    this.requirePermission(context, PERMISSIONS.QUICK_PROMPT_DELETE);
    logger.info({ promptId: id, expectedVersion, operatorId: context.operatorId }, 'Deleting quick prompt');

    try {
      const where = projectId
        ? and(eq(quickPrompts.id, id), eq(quickPrompts.projectId, projectId))
        : eq(quickPrompts.id, id);

      const existing = await db.query.quickPrompts.findFirst({ where });

      if (!existing) {
        throw new NotFoundError(`Quick prompt with id ${id} not found`);
      }

      if (existing.isSystem) {
        throw new ForbiddenError('System prompts cannot be deleted');
      }

      if (existing.ownerId !== context.operatorId) {
        throw new ForbiddenError('Only the owner can delete this prompt');
      }

      if (existing.version !== expectedVersion) {
        throw new OptimisticLockError(`Quick prompt version mismatch. Expected ${expectedVersion}, got ${existing.version}`);
      }

      const deleted = await db.delete(quickPrompts)
        .where(and(
          eq(quickPrompts.id, id),
          eq(quickPrompts.version, expectedVersion),
        ))
        .returning();

      if (deleted.length === 0) {
        throw new OptimisticLockError(`Failed to delete quick prompt due to version conflict`);
      }

      await this.auditService.logDelete('quick_prompt', id, existing, context.operatorId, existing.projectId ?? undefined);
      logger.info({ promptId: id }, 'Quick prompt deleted successfully');
    } catch (error) {
      if (error instanceof NotFoundError || error instanceof ForbiddenError || error instanceof OptimisticLockError) throw error;
      logger.error({ error, promptId: id }, 'Failed to delete quick prompt');
      throw error;
    }
  }

  /**
   * Clones a quick prompt.
   * @param projectId - If provided, validates the prompt belongs to the project
   */
  async cloneQuickPrompt(id: string, input: CloneQuickPromptRequest, context: RequestContext, projectId?: string): Promise<QuickPromptResponse> {
    this.requirePermission(context, PERMISSIONS.QUICK_PROMPT_WRITE);
    logger.info({ promptId: id, operatorId: context.operatorId }, 'Cloning quick prompt');

    try {
      const where = projectId
        ? and(eq(quickPrompts.id, id), eq(quickPrompts.projectId, projectId))
        : eq(quickPrompts.id, id);

      const existing = await db.query.quickPrompts.findFirst({ where });

      if (!existing) {
        throw new NotFoundError(`Quick prompt with id ${id} not found`);
      }

      if (!this.isVisible(existing, context.operatorId)) {
        throw new NotFoundError(`Quick prompt with id ${id} not found`);
      }

      const typed = quickPromptResponseSchema.parse(existing);
      const cloneInput = {
        id: input.id,
        name: input.name ?? `${typed.name} (Clone)`,
        categoryId: typed.categoryId,
        description: typed.description ?? undefined,
        content: typed.content,
        tags: typed.tags,
        isPublic: typed.isPublic,
      };

      if (typed.projectId) {
        return await this.createProjectQuickPrompt(typed.projectId, cloneInput, context);
      }
      return await this.createQuickPrompt(cloneInput, context);
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      logger.error({ error, promptId: id }, 'Failed to clone quick prompt');
      throw error;
    }
  }

  /**
   * Seeds system prompts on first operator creation.
   * @param tx - Optional database transaction. If provided, inserts are executed within the transaction.
   */
  async seedQuickPrompts(tx?: DbTx): Promise<void> {
    const dbClient = tx ?? db;
    logger.info('Seeding system quick prompts');

    try {
      const existing = await dbClient.select({ count: sql<number>`count(*)` }).from(quickPrompts).where(eq(quickPrompts.isSystem, true));
      if (existing[0].count > 0) {
        logger.info('System quick prompts already seeded');
        return;
      }

      const systemPrompts = [
        { categoryId: 'agent' as const, name: 'Helpful assistant', content: 'You are a helpful assistant. Your goal is to provide accurate, concise, and friendly responses.' },
        { categoryId: 'agent' as const, name: 'Customer support agent', content: 'You are a customer support agent. Be empathetic, solution-oriented, and always verify you\'ve resolved the user\'s issue before closing.' },
        { categoryId: 'agent' as const, name: 'Sales agent', content: 'You are a sales representative. Understand the prospect\'s needs, highlight relevant benefits, and guide them toward the next step without being pushy.' },
        { categoryId: 'stage' as const, name: 'Information gathering', content: 'Ask the user for the information needed to proceed. Be polite and explain why each piece of information is required.' },
        { categoryId: 'stage' as const, name: 'Verification stage', content: 'Confirm the details with the user before proceeding. Read back the information and ask for explicit confirmation.' },
        { categoryId: 'filler' as const, name: 'Neutral filler', content: 'Generate a single short neutral sentence to fill silence while processing, like "Hmm, let me think about that."' },
        { categoryId: 'filler' as const, name: 'Acknowledgment filler', content: 'Produce a brief acknowledgment phrase such as "I see" or "Got it" to keep the conversation flowing while the system processes.' },
        { categoryId: 'transformer' as const, name: 'Context summarizer', content: 'Summarize the conversation history into a concise context window. Preserve key facts, user intent, and any constraints mentioned.' },
        { categoryId: 'transformer' as const, name: 'Language normalizer', content: 'Normalize the user\'s input to a consistent format. Fix typos, standardize terminology, and preserve the original meaning.' },
        { categoryId: 'classifier' as const, name: 'Intent classifier', content: 'Classify the user\'s message into one of the available intents. Base your decision on the explicit request and context. Output only the intent name.' },
        { categoryId: 'classifier' as const, name: 'Sentiment classifier', content: 'Determine the sentiment of the user\'s message: positive, neutral, or negative. Consider tone, word choice, and context.' },
        { categoryId: 'tool' as const, name: 'Extraction tool', content: 'Extract structured data from the user\'s message. Return only the relevant fields in the specified format.' },
        { categoryId: 'tool' as const, name: 'Validation tool', content: 'Validate the provided data against the given rules. Return a list of errors or confirm the data is valid.' },
        { categoryId: 'tester' as const, name: 'Persona definition', content: 'You are playing the role of a user for testing purposes. Stay in character, respond naturally, and simulate realistic interactions.' },
        { categoryId: 'tester' as const, name: 'Hang-up decision', content: 'Decide whether the conversation should end. Return true if the goal has been achieved or the conversation is stuck. Return false to continue.' },
        { categoryId: 'summarization' as const, name: 'Conversation summary', content: 'Summarize the entire conversation into key points. Include the user\'s request, actions taken, and the final outcome.' },
        { categoryId: 'summarization' as const, name: 'Action items extraction', content: 'Extract all action items and follow-ups from the conversation. List each item with its responsible party and deadline if mentioned.' },
      ];

      for (const prompt of systemPrompts) {
        await dbClient.insert(quickPrompts).values({
          id: generateId(ID_PREFIXES.QUICK_PROMPT),
          projectId: null,
          categoryId: prompt.categoryId,
          ownerId: null,
          name: prompt.name,
          description: null,
          content: prompt.content,
          tags: [],
          isPublic: true,
          isSystem: true,
          version: 1,
        });
      }

      logger.info({ count: systemPrompts.length }, 'System quick prompts seeded successfully');
    } catch (error) {
      logger.error({ error }, 'Failed to seed system quick prompts');
      throw error;
    }
  }

  /**
   * Checks if a prompt is visible to the given operator.
   */
  private isVisible(prompt: typeof quickPrompts.$inferSelect, operatorId: string): boolean {
    if (prompt.isSystem) return true;
    if (prompt.isPublic) return true;
    return prompt.ownerId === operatorId;
  }
}
