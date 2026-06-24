import { singleton, inject } from 'tsyringe';
import { eq, desc, and } from 'drizzle-orm';
import { db } from '../db/index';
import { benchmarkSuites, benchmarkProviderConfigs, benchmarkConfigs, benchmarkRuns, benchmarkConfigExecutions } from '../db/schema';
import type { CreateBenchmarkSuiteRequest, UpdateBenchmarkSuiteRequest, BenchmarkSuiteResponse, BenchmarkSuiteListResponse, CreateBenchmarkProviderConfigRequest, UpdateBenchmarkProviderConfigRequest, BenchmarkProviderConfigResponse, BenchmarkProviderConfigListResponse, CreateBenchmarkConfigRequest, UpdateBenchmarkConfigRequest, BenchmarkConfigResponse, BenchmarkConfigListResponse } from '../http/contracts/benchmark';
import type { ListParams } from '../http/contracts/common';
import { NotFoundError, OptimisticLockError, ConflictError } from '../errors';
import { logger } from '../utils/logger';
import { BaseService } from './BaseService';
import type { RequestContext } from './RequestContext';
import { PERMISSIONS } from '../permissions';
import { generateId, ID_PREFIXES } from '../utils/idGenerator';
import { normalizeListLimit, countRows } from '../utils/pagination';

import { BenchmarkExecutorService } from './BenchmarkExecutorService';

/**
 * Service for managing benchmark suites, provider configs, and test configs.
 * Provides full CRUD operations for all three benchmark entity types.
 */
@singleton()
export class BenchmarkService extends BaseService {
  constructor(@inject(BenchmarkExecutorService) private readonly executorService: BenchmarkExecutorService) {
    super();
  }
  /**
   * Creates a new benchmark suite.
   * @param input - Suite creation data
   * @param context - Request context for authorization
   * @returns The created suite
   */
  async createSuite(input: CreateBenchmarkSuiteRequest, context: RequestContext): Promise<BenchmarkSuiteResponse> {
    this.requirePermission(context, PERMISSIONS.BENCHMARK_WRITE);
    const id = generateId(ID_PREFIXES.BENCHMARK_SUITE);
    logger.info({ id, name: input.name, operatorId: context.operatorId }, 'Creating benchmark suite');

    const [row] = await db.insert(benchmarkSuites).values({
      id,
      name: input.name,
      description: input.description ?? null,
      cronExpression: input.cronExpression ?? null,
      isActive: input.isActive ?? true,
      tags: input.tags ?? [],
      createdBy: context.operatorId ?? null,
    }).returning();

    this.executorService.refreshSuiteSchedule(row.id, row.cronExpression ?? null, row.isActive);
    return this.mapSuiteResponse(row);
  }

  /**
   * Updates an existing benchmark suite.
   * @param id - Suite ID
   * @param input - Fields to update
   * @param context - Request context for authorization
   * @returns The updated suite
   */
  async updateSuite(id: string, input: UpdateBenchmarkSuiteRequest, context: RequestContext): Promise<BenchmarkSuiteResponse> {
    this.requirePermission(context, PERMISSIONS.BENCHMARK_WRITE);
    const { version: expectedVersion, ...updateData } = input;
    const existing = await this.getSuiteOrThrow(id);
    if (existing.version !== expectedVersion) throw new OptimisticLockError(`Benchmark suite version mismatch. Expected ${expectedVersion}, got ${existing.version}`);
    logger.info({ id, expectedVersion, operatorId: context.operatorId }, 'Updating benchmark suite');

    const updates: Partial<typeof benchmarkSuites.$inferInsert> = {
      updatedAt: new Date(),
      version: existing.version + 1,
    };
    if (updateData.name !== undefined) updates.name = updateData.name;
    if (updateData.description !== undefined) updates.description = updateData.description ?? null;
    if (updateData.cronExpression !== undefined) updates.cronExpression = updateData.cronExpression ?? null;
    if (updateData.isActive !== undefined) updates.isActive = updateData.isActive;
    if (updateData.tags !== undefined) updates.tags = updateData.tags;

    const [updated] = await db.update(benchmarkSuites).set(updates).where(and(eq(benchmarkSuites.id, id), eq(benchmarkSuites.version, expectedVersion))).returning();

    if (!updated) throw new OptimisticLockError(`Failed to update benchmark suite due to version conflict`);
    this.executorService.refreshSuiteSchedule(updated.id, updated.cronExpression ?? null, updated.isActive);
    return this.mapSuiteResponse(updated);
  }

  /**
   * Deletes a benchmark suite by ID.
   * @param id - Suite ID
   * @param context - Request context for authorization
   */
  async deleteSuite(id: string, context: RequestContext): Promise<void> {
    this.requirePermission(context, PERMISSIONS.BENCHMARK_WRITE);
    await this.getSuiteOrThrow(id);
    const [existingConfig] = await db.select({ id: benchmarkConfigs.id }).from(benchmarkConfigs).where(eq(benchmarkConfigs.suiteId, id)).limit(1);
    if (existingConfig) throw new ConflictError(`Benchmark suite ${id} cannot be deleted because it has existing configs. Delete all configs first.`);
    const [existingRun] = await db.select({ id: benchmarkRuns.id }).from(benchmarkRuns).where(eq(benchmarkRuns.suiteId, id)).limit(1);
    if (existingRun) throw new ConflictError(`Benchmark suite ${id} cannot be deleted because it has existing runs. Delete all runs first.`);
    // Cancel the cron schedule before deleting the suite to prevent a race where the cron fires
    // and tries to create a run for a suite that no longer exists.
    this.executorService.refreshSuiteSchedule(id, null, false);
    logger.info({ id, operatorId: context.operatorId }, 'Deleting benchmark suite');
    await db.delete(benchmarkSuites).where(eq(benchmarkSuites.id, id));
  }

  /**
   * Retrieves a benchmark suite by ID.
   * @param id - Suite ID
   * @param context - Optional request context for authorization
   * @returns The suite
   */
  async getSuite(id: string, context: RequestContext): Promise<BenchmarkSuiteResponse> {
    this.requirePermission(context, PERMISSIONS.BENCHMARK_READ);
    const row = await this.getSuiteOrThrow(id);
    return this.mapSuiteResponse(row);
  }

  /**
   * Lists all benchmark suites with pagination.
   * @param params - Pagination parameters (offset, limit)
   * @param context - Request context for authorization
   * @returns Paginated list of suites
   */
  async listSuites(context: RequestContext, params?: ListParams): Promise<BenchmarkSuiteListResponse> {
    this.requirePermission(context, PERMISSIONS.BENCHMARK_READ);
    const offset = params?.offset ?? 0;
    const limit = normalizeListLimit(params?.limit);
    const total = await countRows(benchmarkSuites);
    const rows = await db.select().from(benchmarkSuites).orderBy(desc(benchmarkSuites.createdAt)).limit(limit).offset(offset);
    return { items: rows.map((r) => this.mapSuiteResponse(r)), total, offset, limit };
  }

  // ─── Benchmark Provider Configs ───────────────────────────────────────────

  /**
   * Creates a new benchmark provider config.
   * @param input - Provider config creation data
   * @param context - Request context for authorization
   * @returns The created provider config
   */
  async createProviderConfig(input: CreateBenchmarkProviderConfigRequest, context: RequestContext): Promise<BenchmarkProviderConfigResponse> {
    this.requirePermission(context, PERMISSIONS.BENCHMARK_WRITE);
    const id = generateId(ID_PREFIXES.BENCHMARK_PROVIDER_CONFIG);
    logger.info({ id, name: input.name, providerType: input.providerType, operatorId: context.operatorId }, 'Creating benchmark provider config');

    const [row] = await db.insert(benchmarkProviderConfigs).values({
      id,
      name: input.name,
      providerType: input.providerType,
      providerId: input.providerId,
      settings: input.settings,
      providerSettings: input.providerSettings ? (input.providerSettings as Record<string, unknown>) : null,
    }).returning();

    return this.mapProviderConfigResponse(row);
  }

  /**
   * Updates an existing benchmark provider config.
   * @param id - Provider config ID
   * @param input - Fields to update
   * @param context - Request context for authorization
   * @returns The updated provider config
   */
  async updateProviderConfig(id: string, input: UpdateBenchmarkProviderConfigRequest, context: RequestContext): Promise<BenchmarkProviderConfigResponse> {
    this.requirePermission(context, PERMISSIONS.BENCHMARK_WRITE);
    const { version: expectedVersion, ...updateData } = input;
    const existing = await this.getProviderConfigOrThrow(id);
    if (existing.version !== expectedVersion) throw new OptimisticLockError(`Benchmark provider config version mismatch. Expected ${expectedVersion}, got ${existing.version}`);
    logger.info({ id, expectedVersion, operatorId: context.operatorId }, 'Updating benchmark provider config');

    const updates: Partial<typeof benchmarkProviderConfigs.$inferInsert> = {
      updatedAt: new Date(),
      version: existing.version + 1,
    };
    if (updateData.name !== undefined) updates.name = updateData.name;
    if (updateData.providerId !== undefined) updates.providerId = updateData.providerId;
    if (updateData.settings !== undefined) updates.settings = updateData.settings;
    if (updateData.providerSettings !== undefined) updates.providerSettings = updateData.providerSettings ? (updateData.providerSettings as Record<string, unknown>) : null;

    const [updated] = await db.update(benchmarkProviderConfigs).set(updates).where(and(eq(benchmarkProviderConfigs.id, id), eq(benchmarkProviderConfigs.version, expectedVersion))).returning();

    if (!updated) throw new OptimisticLockError(`Failed to update benchmark provider config due to version conflict`);
    return this.mapProviderConfigResponse(updated);
  }

  /**
   * Deletes a benchmark provider config by ID.
   * @param id - Provider config ID
   * @param context - Request context for authorization
   */
  async deleteProviderConfig(id: string, context: RequestContext): Promise<void> {
    this.requirePermission(context, PERMISSIONS.BENCHMARK_WRITE);
    await this.getProviderConfigOrThrow(id);
    const [referencingConfig] = await db.select({ id: benchmarkConfigs.id }).from(benchmarkConfigs).where(eq(benchmarkConfigs.providerConfigId, id)).limit(1);
    if (referencingConfig) throw new ConflictError(`Benchmark provider config ${id} cannot be deleted because it is referenced by one or more benchmark configs. Delete those configs first.`);
    logger.info({ id, operatorId: context.operatorId }, 'Deleting benchmark provider config');
    await db.delete(benchmarkProviderConfigs).where(eq(benchmarkProviderConfigs.id, id));
  }

  /**
   * Retrieves a benchmark provider config by ID.
   * @param id - Provider config ID
   * @param context - Optional request context for authorization
   * @returns The provider config
   */
  async getProviderConfig(id: string, context: RequestContext): Promise<BenchmarkProviderConfigResponse> {
    this.requirePermission(context, PERMISSIONS.BENCHMARK_READ);
    const row = await this.getProviderConfigOrThrow(id);
    return this.mapProviderConfigResponse(row);
  }

  /**
   * Lists all benchmark provider configs with pagination.
   * @param params - Pagination parameters (offset, limit)
   * @param context - Request context for authorization
   * @returns Paginated list of provider configs
   */
  async listProviderConfigs(context: RequestContext, params?: ListParams): Promise<BenchmarkProviderConfigListResponse> {
    this.requirePermission(context, PERMISSIONS.BENCHMARK_READ);
    const offset = params?.offset ?? 0;
    const limit = normalizeListLimit(params?.limit);
    const total = await countRows(benchmarkProviderConfigs);
    const rows = await db.select().from(benchmarkProviderConfigs).orderBy(desc(benchmarkProviderConfigs.createdAt)).limit(limit).offset(offset);
    return { items: rows.map((r) => this.mapProviderConfigResponse(r)), total, offset, limit };
  }

  // ─── Benchmark Configs ────────────────────────────────────────────────────

  /**
   * Creates a new benchmark config (test case).
   * @param input - Config creation data
   * @param context - Request context for authorization
   * @returns The created config
   */
  async createConfig(input: CreateBenchmarkConfigRequest, context: RequestContext): Promise<BenchmarkConfigResponse> {
    this.requirePermission(context, PERMISSIONS.BENCHMARK_WRITE);
    const id = generateId(ID_PREFIXES.BENCHMARK_CONFIG);
    logger.info({ id, suiteId: input.suiteId, name: input.name, operatorId: context.operatorId }, 'Creating benchmark config');

    await this.getSuiteOrThrow(input.suiteId);
    // Validate that the provider config exists before inserting to avoid a raw DB FK constraint error.
    await this.getProviderConfigOrThrow(input.providerConfigId);

    const [row] = await db.insert(benchmarkConfigs).values({
      id,
      suiteId: input.suiteId,
      name: input.name,
      description: input.description ?? null,
      providerConfigId: input.providerConfigId,
      inputType: input.inputType,
      inputData: input.inputData as Record<string, unknown>,
      repeats: input.repeats ?? 3,
    }).returning();

    return this.mapConfigResponse(row);
  }

  /**
   * Updates an existing benchmark config.
   * @param id - Config ID
   * @param input - Fields to update
   * @param context - Request context for authorization
   * @returns The updated config
   */
  async updateConfig(id: string, input: UpdateBenchmarkConfigRequest, context: RequestContext): Promise<BenchmarkConfigResponse> {
    this.requirePermission(context, PERMISSIONS.BENCHMARK_WRITE);
    const { version: expectedVersion, ...updateData } = input;
    const existing = await this.getConfigOrThrow(id);
    if (existing.version !== expectedVersion) throw new OptimisticLockError(`Benchmark config version mismatch. Expected ${expectedVersion}, got ${existing.version}`);
    logger.info({ id, expectedVersion, operatorId: context.operatorId }, 'Updating benchmark config');

    const updates: Partial<typeof benchmarkConfigs.$inferInsert> = {
      updatedAt: new Date(),
      version: existing.version + 1,
    };
    if (updateData.name !== undefined) updates.name = updateData.name;
    if (updateData.description !== undefined) updates.description = updateData.description ?? null;
    // Validate that the provider config exists before updating to avoid a raw DB FK constraint error.
    if (updateData.providerConfigId !== undefined) {
      await this.getProviderConfigOrThrow(updateData.providerConfigId);
      updates.providerConfigId = updateData.providerConfigId;
    }
    if (updateData.inputType !== undefined) updates.inputType = updateData.inputType;
    if (updateData.inputData !== undefined) updates.inputData = updateData.inputData as Record<string, unknown>;
    if (updateData.repeats !== undefined) updates.repeats = updateData.repeats;

    const [updated] = await db.update(benchmarkConfigs).set(updates).where(and(eq(benchmarkConfigs.id, id), eq(benchmarkConfigs.version, expectedVersion))).returning();

    if (!updated) throw new OptimisticLockError(`Failed to update benchmark config due to version conflict`);
    return this.mapConfigResponse(updated);
  }

  /**
   * Deletes a benchmark config by ID.
   * @param id - Config ID
   * @param context - Request context for authorization
   */
  async deleteConfig(id: string, context: RequestContext): Promise<void> {
    this.requirePermission(context, PERMISSIONS.BENCHMARK_WRITE);
    await this.getConfigOrThrow(id);
    logger.info({ id, operatorId: context.operatorId }, 'Deleting benchmark config');
    await db.delete(benchmarkConfigExecutions).where(eq(benchmarkConfigExecutions.configId, id));
    await db.delete(benchmarkConfigs).where(eq(benchmarkConfigs.id, id));
  }

  /**
   * Retrieves a benchmark config by ID.
   * @param id - Config ID
   * @param context - Optional request context for authorization
   * @returns The config
   */
  async getConfig(id: string, context: RequestContext): Promise<BenchmarkConfigResponse> {
    this.requirePermission(context, PERMISSIONS.BENCHMARK_READ);
    const row = await this.getConfigOrThrow(id);
    return this.mapConfigResponse(row);
  }

  /**
   * Lists all benchmark configs for a given suite with pagination.
   * @param suiteId - Suite ID to filter by
   * @param params - Pagination parameters (offset, limit)
   * @param context - Request context for authorization
   * @returns Paginated list of configs
   */
  async listConfigsForSuite(suiteId: string, context: RequestContext, params?: ListParams): Promise<BenchmarkConfigListResponse> {
    this.requirePermission(context, PERMISSIONS.BENCHMARK_READ);
    const offset = params?.offset ?? 0;
    const limit = normalizeListLimit(params?.limit);
    const whereCondition = eq(benchmarkConfigs.suiteId, suiteId);
    const total = await countRows(benchmarkConfigs, whereCondition);
    const rows = await db.select().from(benchmarkConfigs).where(whereCondition).orderBy(desc(benchmarkConfigs.createdAt)).limit(limit).offset(offset);
    return { items: rows.map((r) => this.mapConfigResponse(r)), total, offset, limit };
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async getSuiteOrThrow(id: string) {
    const [row] = await db.select().from(benchmarkSuites).where(eq(benchmarkSuites.id, id)).limit(1);
    if (!row) throw new NotFoundError(`Benchmark suite ${id} not found`);
    return row;
  }

  private async getProviderConfigOrThrow(id: string) {
    const [row] = await db.select().from(benchmarkProviderConfigs).where(eq(benchmarkProviderConfigs.id, id)).limit(1);
    if (!row) throw new NotFoundError(`Benchmark provider config ${id} not found`);
    return row;
  }

  private async getConfigOrThrow(id: string) {
    const [row] = await db.select().from(benchmarkConfigs).where(eq(benchmarkConfigs.id, id)).limit(1);
    if (!row) throw new NotFoundError(`Benchmark config ${id} not found`);
    return row;
  }

  private mapSuiteResponse(row: typeof benchmarkSuites.$inferSelect): BenchmarkSuiteResponse {
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? null,
      cronExpression: row.cronExpression ?? null,
      isActive: row.isActive,
      tags: row.tags as string[],
      createdBy: row.createdBy ?? null,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private mapProviderConfigResponse(row: typeof benchmarkProviderConfigs.$inferSelect): BenchmarkProviderConfigResponse {
    return {
      id: row.id,
      name: row.name,
      providerType: row.providerType as 'llm' | 'tts' | 'asr',
      providerId: row.providerId,
      settings: row.settings as Record<string, unknown>,
      providerSettings: (row.providerSettings as Record<string, unknown>) ?? null,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private mapConfigResponse(row: typeof benchmarkConfigs.$inferSelect): BenchmarkConfigResponse {
    return {
      id: row.id,
      suiteId: row.suiteId,
      name: row.name,
      description: row.description ?? null,
      providerConfigId: row.providerConfigId,
      inputType: row.inputType as 'messages' | 'text' | 'audio',
      inputData: row.inputData as Record<string, unknown>,
      repeats: row.repeats,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
