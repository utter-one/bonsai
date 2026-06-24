import { singleton, inject } from 'tsyringe';
import { ScenarioRunService } from './ScenarioRunService';
import { ScenarioService } from './ScenarioService';
import { TesterService } from './TesterService';
import { ScenarioConversationService } from './ScenarioConversationService';
import { ScenarioConversationEvaluator } from './ScenarioConversationEvaluator';
import { TestRunner } from './TestRunner';
import { ConversationService } from '../ConversationService';
import { SYSTEM_CONTEXT } from '../RequestContext';
import { UserService } from '../UserService';
import { logger } from '../../utils/logger';
import { generateId, ID_PREFIXES } from '../../utils/idGenerator';
import type { ScenarioRunResponse } from '../../http/contracts/scenarioRun';

/** Status of the scheduler circuit breaker */
export type SchedulerStatus = {
  enabled: boolean;
};

/** A single execution slot within a run: one tester, one conversation */
type ConversationSlot = {
  testerId: string;
  scenarioConversationId: string;
};

/** Result of executing a single conversation slot */
type SlotResult = {
  result: 'passed' | 'failed' | 'error' | 'cancelled';
  passedTests: number;
  failedTests: number;
};

/**
 * Background service that processes queued scenario runs.
 * Picks up 'queued' runs, orchestrates parallel test conversations with a global
 * concurrency semaphore, runs evaluations after each conversation, and updates
 * final pass/fail status on the run record.
 *
 * Includes a circuit breaker (enable/disable) for operational control.
 * A polling fallback ensures missed runs are picked up every 30 seconds;
 * event-driven processing is triggered via notifyNewRun().
 */
@singleton()
export class ScenarioRunExecutorService {
  private enabled: boolean;
  private readonly maxParallel: number;
  private activeRunIds: Set<string> = new Set();
  private cancelledRunIds: Set<string> = new Set();
  private activeSlots: number = 0;
  private pollingTimer: NodeJS.Timeout | null = null;
  private readonly pollingIntervalMs = 30_000;

  constructor(
    @inject(ScenarioRunService) private readonly scenarioRunService: ScenarioRunService,
    @inject(ScenarioService) private readonly scenarioService: ScenarioService,
    @inject(TesterService) private readonly testerService: TesterService,
    @inject(ScenarioConversationService) private readonly scenarioConversationService: ScenarioConversationService,
    @inject(ScenarioConversationEvaluator) private readonly evaluator: ScenarioConversationEvaluator,
    @inject(TestRunner) private readonly testRunner: TestRunner,
    @inject(ConversationService) private readonly conversationService: ConversationService,
    @inject(UserService) private readonly userService: UserService,
  ) {
    this.enabled = process.env.TESTING_SCHEDULER_ENABLED !== 'false';
    this.maxParallel = parseInt(process.env.TESTING_MAX_PARALLEL_CONVERSATIONS ?? '5', 10);
  }

  /**
   * Starts the executor: runs an initial queue check and sets up the polling fallback.
   */
  start(): void {
    logger.info({ maxParallel: this.maxParallel, enabled: this.enabled }, 'Starting ScenarioRunExecutorService');
    this.checkAndProcessQueue();
    this.pollingTimer = setInterval(() => { this.checkAndProcessQueue(); }, this.pollingIntervalMs);
  }

  /**
   * Stops the polling timer. In-flight executions complete naturally.
   */
  stop(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
    logger.info('ScenarioRunExecutorService polling stopped');
  }

  /**
   * Immediately triggers a queue check. Call this after a new run is created.
   */
  notifyNewRun(): void {
    this.checkAndProcessQueue();
  }

  /**
   * Enables the scheduler circuit breaker and immediately checks the queue.
   */
  enable(): void {
    this.enabled = true;
    logger.info('ScenarioRunExecutorService enabled');
    this.checkAndProcessQueue();
  }

  /**
   * Disables the scheduler circuit breaker.
   * In-flight executions complete naturally; no new executions will start.
   */
  disable(): void {
    this.enabled = false;
    logger.info('ScenarioRunExecutorService disabled');
  }

  /**
   * Returns the current circuit breaker status.
   */
  getStatus(): SchedulerStatus {
    return { enabled: this.enabled };
  }

  /**
   * Signals that a run has been cancelled so in-flight slots can bail out early.
   * @param runId - The ID of the scenario run that was cancelled
   */
  signalCancel(runId: string): void {
    this.cancelledRunIds.add(runId);
    logger.info({ runId }, 'Cancellation signalled to executor');
  }

  /**
   * Fetches queued runs and starts execution for any that fit within the concurrency limit.
   */
  private checkAndProcessQueue(): void {
    if (!this.enabled) return;

    this.scenarioRunService.findQueuedRuns().then((runs) => {
      for (const run of runs) {
        if (!this.enabled) break;
        if (this.activeRunIds.has(run.id)) continue;
        if (this.activeSlots >= this.maxParallel) break;
        this.executeRun(run).catch((error) => logger.error({ error, runId: run.id }, 'Unhandled error in ScenarioRunExecutorService.executeRun'));
      }
    }).catch((error) => logger.error({ error }, 'Failed to fetch queued scenario runs'));
  }

  /**
   * Executes a single scenario run end-to-end.
   * Claims the run atomically, creates all conversation slots, runs them with the
   * global semaphore, evaluates each, then marks the run passed or failed.
   * @param run - The queued scenario run to execute
   */
  private async executeRun(run: ScenarioRunResponse): Promise<void> {
    const claimed = await this.scenarioRunService.claimQueuedRun(run.id, run.projectId);
    if (!claimed) {
      logger.debug({ runId: run.id }, 'Scenario run already claimed by another executor, skipping');
      return;
    }

    this.activeRunIds.add(run.id);
    logger.info({ runId: run.id, scenarioId: run.scenarioId }, 'Executing scenario run');

    try {
      const [scenario, testerMap] = await Promise.all([
        this.scenarioService.getScenarioById(run.projectId, run.scenarioId),
        Promise.all(Object.keys(run.testers).map((id) => this.testerService.getTesterById(run.projectId, id))).then((testers) => new Map(testers.map((t) => [t.id, t]))),
      ]);

      const slots: ConversationSlot[] = [];

      for (const [testerId, count] of Object.entries(run.testers)) {
        for (let i = 0; i < count; i++) {
          const scenarioConv = await this.scenarioConversationService.createScenarioConversation({ scenarioRunId: run.id, projectId: run.projectId, scenarioId: run.scenarioId, testerId });
          slots.push({ testerId, scenarioConversationId: scenarioConv.id });
        }
      }

      const results = await Promise.all(slots.map((slot) => this.executeSlot(slot, run, scenario, testerMap)));

      if (this.cancelledRunIds.has(run.id)) {
        logger.info({ runId: run.id }, 'Scenario run was cancelled mid-flight, skipping final status update');
      } else {
        const passedCount = results.filter((r) => r.result === 'passed').length;
        const failedCount = results.filter((r) => r.result === 'failed').length;
        const errorCount = results.filter((r) => r.result === 'error').length;
        const finalStatus = failedCount > 0 ? 'failed' : (passedCount > 0 ? 'passed' : 'failed');
        const statusDetails = failedCount > 0 ? `${failedCount} of ${results.length} conversation${results.length !== 1 ? 's' : ''} failed` : null;
        const runPassedTests = results.reduce((sum, r) => sum + r.passedTests, 0);
        const runFailedTests = results.reduce((sum, r) => sum + r.failedTests, 0);
        await this.scenarioRunService.updateRunStatus(run.id, run.projectId, finalStatus, statusDetails, errorCount, { passedTests: runPassedTests, failedTests: runFailedTests });
        logger.info({ runId: run.id, finalStatus, passedCount, failedCount, errorCount, runPassedTests, runFailedTests }, 'Scenario run completed');
      }
    } catch (error) {
      logger.error({ error, runId: run.id }, 'Scenario run failed with error');
      await this.scenarioRunService.updateRunStatus(run.id, run.projectId, 'failed', (error instanceof Error ? error.message : String(error))).catch(() => {});
    } finally {
      this.activeRunIds.delete(run.id);
      this.cancelledRunIds.delete(run.id);
    }
  }

  /**
   * Executes a single conversation slot, respecting the global concurrency semaphore.
   * Creates the underlying Conversation entity, runs the test, evaluates results, and
   * writes back status and evaluation data.
   * @param slot - The conversation slot (tester + scenarioConversationId)
   * @param run - The parent scenario run
   * @param scenario - The scenario configuration
   * @param testerMap - Map of testerId to tester configuration
   * @returns SlotResult indicating passed, failed, error, or cancelled
   */
  private async executeSlot(
    slot: ConversationSlot,
    run: ScenarioRunResponse,
    scenario: Awaited<ReturnType<ScenarioService['getScenarioById']>>,
    testerMap: Map<string, Awaited<ReturnType<TesterService['getTesterById']>>>,
  ): Promise<SlotResult> {
    if (this.cancelledRunIds.has(run.id)) {
      logger.info({ runId: run.id, scenarioConversationId: slot.scenarioConversationId }, 'Skipping slot — run was cancelled');
        await this.scenarioConversationService.updateScenarioConversationStatus(slot.scenarioConversationId, run.projectId, 'cancelled').catch(() => {});
      return { result: 'cancelled', passedTests: 0, failedTests: 0 };
    }

    await this.acquireSlot();

    try {
      const tester = testerMap.get(slot.testerId)!;
      const syntheticUserId = `tester_${slot.testerId}`;

      await this.userService.ensureUserExists(run.projectId, syntheticUserId);
      await this.userService.resetUserProfile(run.projectId, syntheticUserId, tester.userProfile ?? {});

      const conversationId = generateId(ID_PREFIXES.CONVERSATION);
      const sessionId = generateId(ID_PREFIXES.SCENARIO_CONVERSATION);

      await this.conversationService.createConversation({ id: conversationId, projectId: run.projectId, userId: syntheticUserId, sessionId, stageId: scenario.startingStageId, status: 'initialized' }, SYSTEM_CONTEXT);
      await this.scenarioConversationService.updateScenarioConversationStatus(slot.scenarioConversationId, run.projectId, 'in_progress');
      await this.scenarioConversationService.linkConversation(slot.scenarioConversationId, run.projectId, conversationId);

      const testResult = await this.testRunner.run(conversationId, run.projectId, tester, scenario);
      logger.info({ runId: run.id, scenarioConversationId: slot.scenarioConversationId, testStatus: testResult.status, turnCount: testResult.turnCount }, 'Test conversation completed');

      if (testResult.status === 'conversation_failed') {
        await this.scenarioConversationService.updateScenarioConversationStatus(slot.scenarioConversationId, run.projectId, 'error', { testRunStatus: testResult.status });
        return { result: 'error', passedTests: 0, failedTests: 0 };
      }

      const evaluation = await this.evaluator.evaluate(conversationId, run.projectId, scenario);
      const conversationStatus = evaluation.passed ? 'passed' : 'failed';

      await this.scenarioConversationService.updateScenarioConversationStatus(slot.scenarioConversationId, run.projectId, conversationStatus, { dataExtractionResults: evaluation.dataExtractionResults, dataTransformationResults: evaluation.dataTransformationResults ?? undefined, testRunStatus: testResult.status, testStatistics: { passedTests: evaluation.passedTests, failedTests: evaluation.failedTests } });

      return { result: conversationStatus, passedTests: evaluation.passedTests, failedTests: evaluation.failedTests };
    } catch (error) {
      logger.error({ error, runId: run.id, scenarioConversationId: slot.scenarioConversationId }, 'Conversation slot failed');
      await this.scenarioConversationService.updateScenarioConversationStatus(slot.scenarioConversationId, run.projectId, 'error').catch(() => {});
      return { result: 'error', passedTests: 0, failedTests: 0 };
    } finally {
      this.releaseSlot();
    }
  }

  /**
   * Acquires a concurrency slot, waiting until one becomes available.
   */
  private async acquireSlot(): Promise<void> {
    while (this.activeSlots >= this.maxParallel) {
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
    }
    this.activeSlots++;
  }

  /**
   * Releases a concurrency slot.
   */
  private releaseSlot(): void {
    this.activeSlots = Math.max(0, this.activeSlots - 1);
  }
}
