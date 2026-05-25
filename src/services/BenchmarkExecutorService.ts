import { singleton, inject } from 'tsyringe';
import { eq, inArray, and, sql } from 'drizzle-orm';
import { schedule } from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import { db } from '../db/index';
import { benchmarkSuites, benchmarkConfigs, benchmarkProviderConfigs, benchmarkRuns, benchmarkConfigExecutions, benchmarkResults, providers } from '../db/schema';
import { LlmProviderFactory } from './providers/llm/LlmProviderFactory';
import type { LlmSettings } from './providers/llm/LlmProviderFactory';
import { TtsProviderFactory } from './providers/tts/TtsProviderFactory';
import type { TtsSettings } from './providers/tts/TtsProviderFactory';
import { AsrProviderFactory } from './providers/asr/AsrProviderFactory';
import type { AsrSettings } from './providers/asr/AsrProviderFactory';
import { LlmBenchmarkRunner } from './benchmarking/LlmBenchmarkRunner';
import { TtsBenchmarkRunner } from './benchmarking/TtsBenchmarkRunner';
import { AsrBenchmarkRunner } from './benchmarking/AsrBenchmarkRunner';
import { BenchmarkRunService } from './BenchmarkRunService';
import type { BenchmarkStats, TimingStats } from '../http/contracts/benchmark';
import type { BenchmarkIterationResult, LlmBenchmarkInput, TtsBenchmarkInput, AsrBenchmarkInput } from '../types/benchmark';
import { generateId, ID_PREFIXES } from '../utils/idGenerator';
import { logger } from '../utils/logger';

/**
 * Background service that executes benchmark runs sequentially.
 * Picks up pending runs, runs all configs in order, persists stats on completion.
 * Also schedules cron-based runs for active suites with a cronExpression.
 */
@singleton()
export class BenchmarkExecutorService {
  private isProcessing = false;
  private pollingTimer: ReturnType<typeof setInterval> | null = null;
  private readonly pollingIntervalMs = 30_000;
  private readonly scheduledTasks: Map<string, ScheduledTask> = new Map();

  constructor(
    @inject(LlmProviderFactory) private readonly llmFactory: LlmProviderFactory,
    @inject(TtsProviderFactory) private readonly ttsFactory: TtsProviderFactory,
    @inject(AsrProviderFactory) private readonly asrFactory: AsrProviderFactory,
    @inject(BenchmarkRunService) private readonly runService: BenchmarkRunService,
  ) { }

  /**
   * Starts the executor: resets stuck runs, starts polling, registers as new-run listener,
   * and sets up cron schedules for active suites.
   */
  start(): void {
    logger.info('Starting BenchmarkExecutorService');
    this.runService.registerNewRunListener((runId) => this.onNewRun(runId));
    this.resetStuckRuns().then(() => this.checkAndProcess());
    this.pollingTimer = setInterval(() => { this.checkAndProcess(); }, this.pollingIntervalMs);
    this.loadCronSchedules().catch((err) => logger.error({ err }, 'Failed to load benchmark cron schedules'));
  }

  /**
   * Refreshes the cron schedule for a single suite.
   * Called by BenchmarkService after create/update/delete operations.
   * @param suiteId - Suite ID
   * @param cronExpression - New cron expression, or null to remove
   * @param isActive - Whether the suite is active
   */
  refreshSuiteSchedule(suiteId: string, cronExpression: string | null, isActive: boolean): void {
    if (isActive && cronExpression) {
      this.scheduleSuite(suiteId, cronExpression);
    } else {
      const existing = this.scheduledTasks.get(suiteId);
      if (existing) {
        existing.destroy();
        this.scheduledTasks.delete(suiteId);
        logger.info({ suiteId }, 'Removed benchmark cron schedule');
      }
    }
  }

  /**
   * Stops the executor: clears the polling timer and destroys all cron tasks.
   * Intended for graceful shutdown.
   */
  stop(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
    for (const [suiteId, task] of this.scheduledTasks) {
      task.destroy();
      logger.info({ suiteId }, 'Destroyed benchmark cron task on stop');
    }
    this.scheduledTasks.clear();
    logger.info('BenchmarkExecutorService stopped');
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private onNewRun(_runId: string): void {
    this.checkAndProcess();
  }

  private async resetStuckRuns(): Promise<void> {
    const updated = await db.update(benchmarkRuns).set({ status: 'pending', updatedAt: new Date() }).where(eq(benchmarkRuns.status, 'in_progress')).returning({ id: benchmarkRuns.id });
    if (updated.length > 0) {
      const runIds = updated.map((r) => r.id);
      logger.warn({ count: updated.length, ids: runIds }, 'Reset stuck benchmark runs from in_progress to pending on startup');
      const resetExecutions = await db.update(benchmarkConfigExecutions).set({ status: 'failed', error: 'Reset due to server restart', completedAt: new Date(), updatedAt: new Date() }).where(and(inArray(benchmarkConfigExecutions.runId, runIds), eq(benchmarkConfigExecutions.status, 'in_progress'))).returning({ id: benchmarkConfigExecutions.id });
      if (resetExecutions.length > 0) logger.warn({ count: resetExecutions.length }, 'Reset stuck benchmark config executions to failed on startup');
    }
  }

  private checkAndProcess(): void {
    if (this.isProcessing) return;
    this.isProcessing = true;
    this.processNextPendingRun()
      .catch((err) => logger.error({ err }, 'Unhandled error in BenchmarkExecutorService.processNextPendingRun'))
      .finally(() => { this.isProcessing = false; });
  }

  private async processNextPendingRun(): Promise<void> {
    while (true) {
      const [run] = await db.select().from(benchmarkRuns).where(eq(benchmarkRuns.status, 'pending')).limit(1);
      if (!run) return;

      logger.info({ runId: run.id, suiteId: run.suiteId }, 'Processing benchmark run');

      await db.update(benchmarkRuns).set({ status: 'in_progress', startedAt: new Date(), updatedAt: new Date() }).where(eq(benchmarkRuns.id, run.id));

      try {
        const configs = await db.select().from(benchmarkConfigs).where(eq(benchmarkConfigs.suiteId, run.suiteId));

        for (const config of configs) {
          await this.processConfigExecution(run.id, config);
        }

        await db.update(benchmarkRuns).set({ status: 'completed', completedAt: new Date(), updatedAt: new Date() }).where(eq(benchmarkRuns.id, run.id));
        logger.info({ runId: run.id }, 'Benchmark run completed');
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        logger.error({ runId: run.id, error }, 'Benchmark run failed');
        await db.update(benchmarkRuns).set({ status: 'failed', completedAt: new Date(), error, updatedAt: new Date() }).where(eq(benchmarkRuns.id, run.id));
      }
    }
  }

  private async processConfigExecution(runId: string, config: typeof benchmarkConfigs.$inferSelect): Promise<void> {
    const executionId = generateId(ID_PREFIXES.BENCHMARK_CONFIG_EXECUTION);
    const now = new Date();

    await db.insert(benchmarkConfigExecutions).values({ id: executionId, runId, configId: config.id, status: 'in_progress', startedAt: now });

    try {
      const providerConfigRow = await db.query.benchmarkProviderConfigs.findFirst({ where: eq(benchmarkProviderConfigs.id, config.providerConfigId) });
      if (!providerConfigRow) throw new Error(`Benchmark provider config ${config.providerConfigId} not found`);

      const providerRow = await db.query.providers.findFirst({ where: eq(providers.id, providerConfigRow.providerId) });
      if (!providerRow) throw new Error(`Provider ${providerConfigRow.providerId} not found`);

      const iterationResults: BenchmarkIterationResult[] = [];

      for (let i = 0; i < config.repeats; i++) {
        const resultId = generateId(ID_PREFIXES.BENCHMARK_RESULT);

        const result = await this.runIteration(providerRow, providerConfigRow, config);

        await db.insert(benchmarkResults).values({
          id: resultId,
          configExecutionId: executionId,
          iterationIndex: i,
          startedAt: result.startedAt,
          completedAt: result.completedAt,
          result: { error: result.error, timeToFirstChunkMs: result.timeToFirstChunkMs, chunkCount: result.chunkCount, chunkTimings: result.chunkTimings, output: result.output },
        });

        iterationResults.push(result);
        logger.info({ executionId, iterationIndex: i, error: result.error ?? undefined }, 'Benchmark iteration complete');
      }

      const stats = this.computeBenchmarkStats(iterationResults);

      await db.update(benchmarkConfigExecutions).set({ status: 'completed', completedAt: new Date(), stats: stats as unknown as Record<string, unknown>, updatedAt: new Date(), version: sql`${benchmarkConfigExecutions.version} + 1` }).where(eq(benchmarkConfigExecutions.id, executionId));
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error({ executionId, configId: config.id, error }, 'Benchmark config execution failed');
      await db.update(benchmarkConfigExecutions).set({ status: 'failed', completedAt: new Date(), error, updatedAt: new Date(), version: sql`${benchmarkConfigExecutions.version} + 1` }).where(eq(benchmarkConfigExecutions.id, executionId));
    }
  }

  private async runIteration(providerRow: typeof providers.$inferSelect, providerConfigRow: typeof benchmarkProviderConfigs.$inferSelect, config: typeof benchmarkConfigs.$inferSelect): Promise<BenchmarkIterationResult> {
    const baseSettings = providerConfigRow.settings as Record<string, unknown>;
    const configOverrides = (providerConfigRow.providerSettings as Record<string, unknown> | null) ?? {};
    const settings = { ...baseSettings, ...configOverrides };
    const inputData = config.inputData as Record<string, unknown>;

    switch (providerConfigRow.providerType) {
      case 'llm': {
        const runner = new LlmBenchmarkRunner(providerRow, settings as LlmSettings, this.llmFactory);
        return runner.run(inputData as unknown as LlmBenchmarkInput);
      }
      case 'tts': {
        const runner = new TtsBenchmarkRunner(providerRow, settings as TtsSettings, this.ttsFactory);
        return runner.run(inputData as unknown as TtsBenchmarkInput);
      }
      case 'asr': {
        const runner = new AsrBenchmarkRunner(providerRow, settings as AsrSettings, this.asrFactory);
        return runner.run(inputData as unknown as AsrBenchmarkInput);
      }
      default:
        throw new Error(`Unsupported provider type: ${providerConfigRow.providerType}`);
    }
  }

  private computeBenchmarkStats(results: BenchmarkIterationResult[]): BenchmarkStats {
    const completed = results.filter((r) => r.error === null);
    const failed = results.filter((r) => r.error !== null);

    const totalDurations = completed.map((r) => r.completedAt.getTime() - r.startedAt.getTime());
    const ttftValues = completed.map((r) => r.timeToFirstChunkMs).filter((v): v is number => v !== null);
    const chunkIntervals = completed.flatMap((r) => r.chunkTimings);

    return {
      totalDurationMs: this.computeTimingStats(totalDurations),
      timeToFirstChunkMs: ttftValues.length > 0 ? this.computeTimingStats(ttftValues) : null,
      chunkIntervalMs: chunkIntervals.length > 1 ? this.computeTimingStats(chunkIntervals) : null,
      successRate: results.length > 0 ? completed.length / results.length : 0,
      completedIterations: completed.length,
      failedIterations: failed.length,
    };
  }

  private computeTimingStats(values: number[]): TimingStats {
    if (values.length === 0) return { avg: 0, median: 0, p50: 0, p95: 0, p99: 0, min: 0, max: 0 };

    const sorted = [...values].sort((a, b) => a - b);
    const avg = sorted.reduce((s, v) => s + v, 0) / sorted.length;
    const percentile = (p: number) => sorted[Math.ceil((p / 100) * sorted.length) - 1] ?? sorted[sorted.length - 1];
    const p50 = percentile(50);

    return {
      avg: Math.round(avg),
      median: p50,
      p50,
      p95: percentile(95),
      p99: percentile(99),
      min: sorted[0],
      max: sorted[sorted.length - 1],
    };
  }

  private async loadCronSchedules(): Promise<void> {
    const activeSuites = await db.select().from(benchmarkSuites).where(eq(benchmarkSuites.isActive, true));

    for (const suite of activeSuites) {
      if (!suite.cronExpression) continue;
      this.scheduleSuite(suite.id, suite.cronExpression);
    }

    logger.info({ count: this.scheduledTasks.size }, 'Loaded benchmark cron schedules');
  }

  private scheduleSuite(suiteId: string, cronExpression: string): void {
    const existing = this.scheduledTasks.get(suiteId);
    if (existing) {
      existing.destroy();
      this.scheduledTasks.delete(suiteId);
    }

    try {
      const task = schedule(cronExpression, async () => {
        try {
          const [suite] = await db.select({ id: benchmarkSuites.id, isActive: benchmarkSuites.isActive }).from(benchmarkSuites).where(eq(benchmarkSuites.id, suiteId)).limit(1);
          if (!suite || !suite.isActive) {
            logger.warn({ suiteId }, 'Skipping scheduled benchmark run: suite not found or inactive');
            return;
          }
          logger.info({ suiteId }, 'Triggering scheduled benchmark run');
          const [row] = await db.insert(benchmarkRuns).values({ id: generateId(ID_PREFIXES.BENCHMARK_RUN), suiteId, trigger: 'scheduled', status: 'pending' }).returning();
          this.onNewRun(row.id);
        } catch (err) {
          logger.error({ suiteId, cronExpression, err }, 'Failed to trigger scheduled benchmark run');
        }
      });
      this.scheduledTasks.set(suiteId, task);
      logger.info({ suiteId, cronExpression }, 'Scheduled benchmark cron task');
    } catch (err) {
      logger.error({ suiteId, cronExpression, err }, 'Failed to schedule benchmark cron task');
    }
  }
}
