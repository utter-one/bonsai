import { singleton } from 'tsyringe';
import { eq, desc, and } from 'drizzle-orm';
import { db } from '../db/index';
import { benchmarkRuns, benchmarkConfigExecutions, benchmarkResults } from '../db/schema';
import type { BenchmarkRunResponse, BenchmarkRunListResponse, BenchmarkConfigExecutionResponse, BenchmarkResultResponse, TriggerBenchmarkRunRequest, BenchmarkRunListParams } from '../http/contracts/benchmark';
import type { BenchmarkStats } from '../http/contracts/benchmark';
import { NotFoundError, ConflictError } from '../errors';
import { logger } from '../utils/logger';
import { BaseService } from './BaseService';
import type { RequestContext } from './RequestContext';
import { PERMISSIONS } from '../permissions';
import { generateId, ID_PREFIXES } from '../utils/idGenerator';
import { normalizeListLimit, countRows } from '../utils/pagination';

/**
 * Service for managing benchmark runs and their execution results.
 * Handles triggering new runs, querying run state, and retrieving iteration results.
 */
@singleton()
export class BenchmarkRunService extends BaseService {
  /** Registered listener called when a new run is created, allowing the executor to pick it up. */
  private newRunListener: ((runId: string) => void) | null = null;

  /**
   * Registers a listener to be called when a new run is triggered.
   * Called by BenchmarkExecutorService during startup to avoid circular DI.
   * @param listener - Function to call with the new run's ID
   */
  registerNewRunListener(listener: (runId: string) => void): void {
    this.newRunListener = listener;
  }

  /**
   * Triggers a new manual benchmark run for the given suite.
   * @param input - Suite ID to run
   * @param context - Request context for authorization
   * @returns The created run record
   */
  async triggerRun(input: TriggerBenchmarkRunRequest, context: RequestContext): Promise<BenchmarkRunResponse> {
    this.requirePermission(context, PERMISSIONS.BENCHMARK_RUN);
    const id = generateId(ID_PREFIXES.BENCHMARK_RUN);
    logger.info({ id, suiteId: input.suiteId, operatorId: context.operatorId }, 'Triggering benchmark run');

    const [row] = await db.insert(benchmarkRuns).values({
      id,
      suiteId: input.suiteId,
      trigger: 'manual',
      status: 'pending',
    }).returning();

    this.newRunListener?.(id);

    return this.mapRunResponse(row);
  }

  /**
   * Lists benchmark runs with pagination, optionally filtered by suite ID or status.
   * @param query - Filter and pagination parameters
   * @param context - Optional request context for authorization
   * @returns Paginated list of runs
   */
  async listRuns(query: BenchmarkRunListParams, context?: RequestContext): Promise<BenchmarkRunListResponse> {
    if (context) this.requirePermission(context, PERMISSIONS.BENCHMARK_READ);
    const offset = query.offset ?? 0;
    const limit = normalizeListLimit(query.limit);

    const conditions = [];
    if (query.suiteId) conditions.push(eq(benchmarkRuns.suiteId, query.suiteId));
    if (query.status) conditions.push(eq(benchmarkRuns.status, query.status));
    const whereCondition = conditions.length > 0 ? and(...conditions) : undefined;

    const total = await countRows(benchmarkRuns, whereCondition);
    const rows = await db.select().from(benchmarkRuns).where(whereCondition).orderBy(desc(benchmarkRuns.createdAt)).limit(limit).offset(offset);
    return { items: rows.map((r) => this.mapRunResponse(r)), total, offset, limit };
  }

  /**
   * Retrieves a benchmark run by ID, including its config executions.
   * @param id - Run ID
   * @param context - Optional request context for authorization
   * @returns The run with embedded executions
   */
  async getRunById(id: string, context?: RequestContext): Promise<BenchmarkRunResponse> {
    if (context) this.requirePermission(context, PERMISSIONS.BENCHMARK_READ);

    const [run] = await db.select().from(benchmarkRuns).where(eq(benchmarkRuns.id, id)).limit(1);
    if (!run) throw new NotFoundError(`Benchmark run ${id} not found`);

    const executions = await db.select().from(benchmarkConfigExecutions).where(eq(benchmarkConfigExecutions.runId, id)).orderBy(benchmarkConfigExecutions.createdAt);

    return {
      ...this.mapRunResponse(run),
      executions: executions.map((e) => this.mapExecutionResponse(e)),
    };
  }

  /**
   * Lists all iteration results for a given config execution.
   * @param configExecutionId - Config execution ID
   * @param context - Optional request context for authorization
   * @returns Array of iteration results
   */
  async getRunResults(configExecutionId: string, context?: RequestContext): Promise<BenchmarkResultResponse[]> {
    if (context) this.requirePermission(context, PERMISSIONS.BENCHMARK_READ);

    const rows = await db.select().from(benchmarkResults).where(eq(benchmarkResults.configExecutionId, configExecutionId)).orderBy(benchmarkResults.iterationIndex);
    return rows.map((r) => this.mapResultResponse(r));
  }

  /**
   * Deletes a benchmark run and all its associated executions and results.
   * Blocked if the run is currently in progress.
   * @param id - Run ID
   * @param context - Request context for authorization
   */
  async deleteRun(id: string, context: RequestContext): Promise<void> {
    this.requirePermission(context, PERMISSIONS.BENCHMARK_WRITE);
    const [run] = await db.select().from(benchmarkRuns).where(eq(benchmarkRuns.id, id)).limit(1);
    if (!run) throw new NotFoundError(`Benchmark run ${id} not found`);
    if (run.status === 'in_progress') throw new ConflictError(`Benchmark run ${id} cannot be deleted while it is in progress.`);
    logger.info({ id, operatorId: context.operatorId }, 'Deleting benchmark run');
    await db.delete(benchmarkRuns).where(eq(benchmarkRuns.id, id));
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private mapRunResponse(row: typeof benchmarkRuns.$inferSelect, executions?: BenchmarkConfigExecutionResponse[]): BenchmarkRunResponse {
    return {
      id: row.id,
      suiteId: row.suiteId,
      trigger: row.trigger as 'manual' | 'scheduled',
      status: row.status as 'pending' | 'in_progress' | 'completed' | 'failed',
      startedAt: row.startedAt ?? null,
      completedAt: row.completedAt ?? null,
      error: row.error ?? null,
      executions,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private mapExecutionResponse(row: typeof benchmarkConfigExecutions.$inferSelect): BenchmarkConfigExecutionResponse {
    return {
      id: row.id,
      runId: row.runId,
      configId: row.configId,
      status: row.status as 'pending' | 'in_progress' | 'completed' | 'failed',
      stats: row.stats ? (row.stats as unknown as BenchmarkStats) : null,
      startedAt: row.startedAt ?? null,
      completedAt: row.completedAt ?? null,
      error: row.error ?? null,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private mapResultResponse(row: typeof benchmarkResults.$inferSelect): BenchmarkResultResponse {
    return {
      id: row.id,
      configExecutionId: row.configExecutionId,
      iterationIndex: row.iterationIndex,
      startedAt: row.startedAt,
      completedAt: row.completedAt ?? null,
      result: row.result as BenchmarkResultResponse['result'],
      createdAt: row.createdAt,
    };
  }
}
