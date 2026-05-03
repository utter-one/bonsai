import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ScenarioRunResponse } from '../../../src/http/contracts/scenarioRun';

vi.mock('../../../src/services/testing/ScenarioRunService', () => {
  const findQueuedRuns = vi.fn().mockResolvedValue([]);
  const claimQueuedRun = vi.fn().mockResolvedValue(true);
  const updateRunStatus = vi.fn().mockResolvedValue(undefined);
  return {
    ScenarioRunService: class {
      findQueuedRuns = findQueuedRuns;
      claimQueuedRun = claimQueuedRun;
      updateRunStatus = updateRunStatus;
    },
    __mocks: { findQueuedRuns, claimQueuedRun, updateRunStatus },
  };
});

vi.mock('../../../src/services/testing/ScenarioService', () => {
  const getScenarioById = vi.fn();
  return {
    ScenarioService: class {
      getScenarioById = getScenarioById;
    },
    __mocks: { getScenarioById },
  };
});

vi.mock('../../../src/services/testing/TesterService', () => {
  const getTesterById = vi.fn();
  return {
    TesterService: class {
      getTesterById = getTesterById;
    },
    __mocks: { getTesterById },
  };
});

vi.mock('../../../src/services/testing/ScenarioConversationService', () => {
  const createScenarioConversation = vi.fn();
  const updateScenarioConversationStatus = vi.fn().mockResolvedValue(undefined);
  const linkConversation = vi.fn().mockResolvedValue(undefined);
  return {
    ScenarioConversationService: class {
      createScenarioConversation = createScenarioConversation;
      updateScenarioConversationStatus = updateScenarioConversationStatus;
      linkConversation = linkConversation;
    },
    __mocks: { createScenarioConversation, updateScenarioConversationStatus, linkConversation },
  };
});

vi.mock('../../../src/services/testing/ScenarioConversationEvaluator', () => {
  const evaluate = vi.fn();
  return {
    ScenarioConversationEvaluator: class {
      evaluate = evaluate;
    },
    __mocks: { evaluate },
  };
});

vi.mock('../../../src/services/testing/TestRunner', () => {
  const run = vi.fn();
  return {
    TestRunner: class {
      run = run;
    },
    __mocks: { run },
  };
});

vi.mock('../../../src/services/ConversationService', () => {
  const createConversation = vi.fn().mockResolvedValue(undefined);
  return {
    ConversationService: class {
      createConversation = createConversation;
    },
    __mocks: { createConversation },
  };
});

vi.mock('../../../src/services/UserService', () => {
  const ensureUserExists = vi.fn().mockResolvedValue(undefined);
  return {
    UserService: class {
      ensureUserExists = ensureUserExists;
    },
    __mocks: { ensureUserExists },
  };
});

vi.mock('../../../src/utils/idGenerator', () => ({
  generateId: vi.fn().mockReturnValue('conv_test001'),
  ID_PREFIXES: { CONVERSATION: 'conv', SCENARIO_CONVERSATION: 'scconv' },
}));

vi.mock('../../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { ScenarioRunExecutorService } from '../../../src/services/testing/ScenarioRunExecutorService';
import { ScenarioRunService, __mocks as srsMocks } from '../../../src/services/testing/ScenarioRunService';
import { ScenarioService, __mocks as ssMocks } from '../../../src/services/testing/ScenarioService';
import { TesterService, __mocks as tsMocks } from '../../../src/services/testing/TesterService';
import { ScenarioConversationService, __mocks as scsMocks } from '../../../src/services/testing/ScenarioConversationService';
import { ScenarioConversationEvaluator, __mocks as evlMocks } from '../../../src/services/testing/ScenarioConversationEvaluator';
import { TestRunner, __mocks as trMocks } from '../../../src/services/testing/TestRunner';
import { ConversationService, __mocks as csMocks } from '../../../src/services/ConversationService';
import { UserService, __mocks as usMocks } from '../../../src/services/UserService';

const mockFindQueuedRuns = srsMocks.findQueuedRuns;
const mockClaimQueuedRun = srsMocks.claimQueuedRun;
const mockUpdateRunStatus = srsMocks.updateRunStatus;
const mockGetScenarioById = ssMocks.getScenarioById;
const mockGetTesterById = tsMocks.getTesterById;
const mockCreateScenarioConversation = scsMocks.createScenarioConversation;
const mockUpdateScenarioConvStatus = scsMocks.updateScenarioConversationStatus;
const mockLinkConversation = scsMocks.linkConversation;
const mockEvaluate = evlMocks.evaluate;
const mockTestRunnerRun = trMocks.run;
const mockCreateConversation = csMocks.createConversation;
const mockEnsureUserExists = usMocks.ensureUserExists;

const createMockRun = (overrides: Partial<ScenarioRunResponse> = {}): ScenarioRunResponse => ({
  id: 'srun_test001',
  projectId: 'proj_test001',
  scenarioId: 'scen_test001',
  status: 'queued',
  testers: { tester_001: 2 },
  startedAt: null,
  completedAt: null,
  finalStatus: null,
  statusDetails: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const flushPromises = () => new Promise((r) => setImmediate(r));

const createExecutor = () =>
  new ScenarioRunExecutorService(
    new ScenarioRunService(),
    new ScenarioService(),
    new TesterService(),
    new ScenarioConversationService(),
    new ScenarioConversationEvaluator(),
    new TestRunner(),
    new ConversationService(),
    new UserService(),
  );

const defaultMocks = () => {
  mockFindQueuedRuns.mockResolvedValue([]);
  mockClaimQueuedRun.mockResolvedValue(true);
  mockUpdateRunStatus.mockResolvedValue(undefined);
  mockGetScenarioById.mockResolvedValue({
    id: 'scen_test001',
    name: 'Test Scenario',
    startingStageId: 'stage_start',
    evaluationCriteria: [],
  });
  mockGetTesterById.mockResolvedValue({
    id: 'tester_001',
    name: 'Test Tester',
  });
  mockCreateScenarioConversation.mockResolvedValue({ id: 'sconv_test001' });
  mockEvaluate.mockResolvedValue({ passed: true, dataExtractionResults: null });
  mockTestRunnerRun.mockResolvedValue({ status: 'completed', turnCount: 5 });
};

describe('ScenarioRunExecutorService', () => {
  describe('start/stop (with fake timers)', () => {
    let executor: ScenarioRunExecutorService;

    beforeEach(() => {
      vi.clearAllMocks();
      vi.useFakeTimers();
      process.env.TESTING_SCHEDULER_ENABLED = 'true';
      process.env.TESTING_MAX_PARALLEL_CONVERSATIONS = '5';
      defaultMocks();
      executor = createExecutor();
    });

    afterEach(() => {
      executor.stop();
      vi.useRealTimers();
      delete process.env.TESTING_SCHEDULER_ENABLED;
      delete process.env.TESTING_MAX_PARALLEL_CONVERSATIONS;
    });

    it('starts polling on initialize', () => {
      executor.start();
      expect(mockFindQueuedRuns).toHaveBeenCalled();
    });

    it('sets up polling interval', () => {
      executor.start();
      vi.advanceTimersByTime(30_000);
      expect(mockFindQueuedRuns).toHaveBeenCalledTimes(2);
    });

    it('stops polling when stop is called', () => {
      executor.start();
      executor.stop();
      const callsBefore = mockFindQueuedRuns.mock.calls.length;
      vi.advanceTimersByTime(30_000);
      expect(mockFindQueuedRuns).toHaveBeenCalledTimes(callsBefore);
    });

    it('does not throw when stop is called without start', () => {
      expect(() => executor.stop()).not.toThrow();
    });
  });

  describe('circuit breaker (state)', () => {
    let executor: ScenarioRunExecutorService;

    beforeEach(() => {
      vi.clearAllMocks();
      process.env.TESTING_SCHEDULER_ENABLED = 'true';
      defaultMocks();
      executor = createExecutor();
    });

    afterEach(() => {
      executor.stop();
      delete process.env.TESTING_SCHEDULER_ENABLED;
    });

    it('is enabled by default', () => {
      expect(executor.getStatus().enabled).toBe(true);
    });

    it('can be disabled', () => {
      executor.disable();
      expect(executor.getStatus().enabled).toBe(false);
    });

    it('can be re-enabled', async () => {
      executor.disable();
      executor.enable();
      expect(executor.getStatus().enabled).toBe(true);
    });

    it('skips queue processing when disabled', () => {
      executor.disable();
      mockFindQueuedRuns.mockResolvedValue([createMockRun()]);
      executor.notifyNewRun();
      expect(mockFindQueuedRuns).not.toHaveBeenCalled();
    });

    it('respects TESTING_SCHEDULER_ENABLED=false env var', () => {
      process.env.TESTING_SCHEDULER_ENABLED = 'false';
      const instance = createExecutor();
      expect(instance.getStatus().enabled).toBe(false);
      instance.stop();
    });
  });

  describe('notifyNewRun', () => {
    let executor: ScenarioRunExecutorService;

    beforeEach(() => {
      vi.clearAllMocks();
      process.env.TESTING_SCHEDULER_ENABLED = 'true';
      defaultMocks();
      executor = createExecutor();
    });

    afterEach(() => {
      executor.stop();
      delete process.env.TESTING_SCHEDULER_ENABLED;
    });

    it('triggers immediate queue check', () => {
      executor.notifyNewRun();
      expect(mockFindQueuedRuns).toHaveBeenCalled();
    });
  });

  describe('queue processing (async)', () => {
    it('processes queued runs', async () => {
      vi.clearAllMocks();
      process.env.TESTING_SCHEDULER_ENABLED = 'true';
      defaultMocks();
      const executor = createExecutor();

      const run = createMockRun();
      mockFindQueuedRuns.mockResolvedValue([run]);

      executor.notifyNewRun();
      await flushPromises();

      expect(mockClaimQueuedRun).toHaveBeenCalledWith(run.id, run.projectId);
      executor.stop();
    });

    it('processes multiple distinct runs from the same batch', async () => {
      vi.clearAllMocks();
      process.env.TESTING_SCHEDULER_ENABLED = 'true';
      defaultMocks();
      const executor = createExecutor();

      const run1 = createMockRun({ id: 'srun_001' });
      const run2 = createMockRun({ id: 'srun_002' });
      mockFindQueuedRuns.mockResolvedValue([run1, run2]);

      executor.notifyNewRun();
      await flushPromises();

      expect(mockClaimQueuedRun).toHaveBeenCalledWith('srun_001', 'proj_test001');
      expect(mockClaimQueuedRun).toHaveBeenCalledWith('srun_002', 'proj_test001');
      executor.stop();
    });

    it('respects concurrency limit by throttling slots, not claims', async () => {
      vi.clearAllMocks();
      process.env.TESTING_SCHEDULER_ENABLED = 'true';
      process.env.TESTING_MAX_PARALLEL_CONVERSATIONS = '5';
      defaultMocks();
      const instance = createExecutor();

      const run1 = createMockRun({ id: 'srun_001', testers: { tester_001: 3 } });
      const run2 = createMockRun({ id: 'srun_002', testers: { tester_001: 2 } });
      mockFindQueuedRuns.mockResolvedValue([run1, run2]);

      instance.notifyNewRun();
      await flushPromises();

      expect(mockClaimQueuedRun).toHaveBeenCalledWith('srun_001', 'proj_test001');
      expect(mockClaimQueuedRun).toHaveBeenCalledWith('srun_002', 'proj_test001');
      expect(mockCreateScenarioConversation).toHaveBeenCalledTimes(5);
      instance.stop();
    });
  });

  describe('executeRun (async)', () => {
    it('claims the run before execution', async () => {
      vi.clearAllMocks();
      process.env.TESTING_SCHEDULER_ENABLED = 'true';
      defaultMocks();
      const executor = createExecutor();

      const run = createMockRun();
      mockFindQueuedRuns.mockResolvedValue([run]);

      executor.notifyNewRun();
      await flushPromises();

      expect(mockClaimQueuedRun).toHaveBeenCalledWith('srun_test001', 'proj_test001');
      executor.stop();
    });

    it('skips already claimed runs', async () => {
      vi.clearAllMocks();
      process.env.TESTING_SCHEDULER_ENABLED = 'true';
      defaultMocks();
      mockClaimQueuedRun.mockResolvedValue(false);
      const executor = createExecutor();

      const run = createMockRun();
      mockFindQueuedRuns.mockResolvedValue([run]);

      executor.notifyNewRun();
      await flushPromises();

      expect(mockGetScenarioById).not.toHaveBeenCalled();
      executor.stop();
    });

    it('creates scenario conversations for each tester slot', async () => {
      vi.clearAllMocks();
      process.env.TESTING_SCHEDULER_ENABLED = 'true';
      defaultMocks();
      const executor = createExecutor();

      const run = createMockRun({ testers: { tester_001: 2 } });
      mockFindQueuedRuns.mockResolvedValue([run]);

      executor.notifyNewRun();
      await flushPromises();

      expect(mockCreateScenarioConversation).toHaveBeenCalledTimes(2);
      executor.stop();
    });

    it('marks run as passed when all conversations pass', async () => {
      vi.clearAllMocks();
      process.env.TESTING_SCHEDULER_ENABLED = 'true';
      defaultMocks();
      mockEvaluate.mockResolvedValue({ passed: true, dataExtractionResults: null });
      const executor = createExecutor();

      const run = createMockRun({ testers: { tester_001: 1 } });
      mockFindQueuedRuns.mockResolvedValue([run]);

      executor.notifyNewRun();
      await flushPromises();

      expect(mockUpdateRunStatus).toHaveBeenCalledWith('srun_test001', 'proj_test001', 'passed', null);
      executor.stop();
    });

    it('marks run as failed when any conversation fails', async () => {
      vi.clearAllMocks();
      process.env.TESTING_SCHEDULER_ENABLED = 'true';
      defaultMocks();
      mockEvaluate.mockResolvedValueOnce({ passed: false, dataExtractionResults: null });
      const executor = createExecutor();

      const run = createMockRun({ testers: { tester_001: 2 } });
      mockFindQueuedRuns.mockResolvedValue([run]);

      executor.notifyNewRun();
      await flushPromises();
      await flushPromises();
      await flushPromises();

      expect(mockUpdateRunStatus).toHaveBeenCalledWith('srun_test001', 'proj_test001', 'failed', expect.any(String));
      executor.stop();
    });

    it('handles execution errors gracefully', async () => {
      vi.clearAllMocks();
      process.env.TESTING_SCHEDULER_ENABLED = 'true';
      defaultMocks();
      mockGetScenarioById.mockRejectedValue(new Error('scenario not found'));
      const executor = createExecutor();

      const run = createMockRun();
      mockFindQueuedRuns.mockResolvedValue([run]);

      executor.notifyNewRun();
      await flushPromises();

      expect(mockUpdateRunStatus).toHaveBeenCalledWith('srun_test001', 'proj_test001', 'failed', 'scenario not found');
      executor.stop();
    });
  });

  describe('executeSlot (async)', () => {
    it('creates conversation and runs test', async () => {
      vi.clearAllMocks();
      process.env.TESTING_SCHEDULER_ENABLED = 'true';
      defaultMocks();
      const executor = createExecutor();

      const run = createMockRun({ testers: { tester_001: 1 } });
      mockFindQueuedRuns.mockResolvedValue([run]);

      executor.notifyNewRun();
      await flushPromises();

      expect(mockCreateConversation).toHaveBeenCalled();
      expect(mockTestRunnerRun).toHaveBeenCalled();
      executor.stop();
    });

    it('updates conversation status through lifecycle', async () => {
      vi.clearAllMocks();
      process.env.TESTING_SCHEDULER_ENABLED = 'true';
      defaultMocks();
      const executor = createExecutor();

      const run = createMockRun({ testers: { tester_001: 1 } });
      mockFindQueuedRuns.mockResolvedValue([run]);

      executor.notifyNewRun();
      await flushPromises();

      expect(mockUpdateScenarioConvStatus).toHaveBeenCalledWith('sconv_test001', 'proj_test001', 'in_progress');
      expect(mockUpdateScenarioConvStatus).toHaveBeenCalledWith('sconv_test001', 'proj_test001', 'passed', expect.any(Object));
      executor.stop();
    });

    it('links conversation to scenario conversation', async () => {
      vi.clearAllMocks();
      process.env.TESTING_SCHEDULER_ENABLED = 'true';
      defaultMocks();
      const executor = createExecutor();

      const run = createMockRun({ testers: { tester_001: 1 } });
      mockFindQueuedRuns.mockResolvedValue([run]);

      executor.notifyNewRun();
      await flushPromises();

      expect(mockLinkConversation).toHaveBeenCalled();
      executor.stop();
    });

    it('ensures user exists before test run', async () => {
      vi.clearAllMocks();
      process.env.TESTING_SCHEDULER_ENABLED = 'true';
      defaultMocks();
      const executor = createExecutor();

      const run = createMockRun({ testers: { tester_001: 1 } });
      mockFindQueuedRuns.mockResolvedValue([run]);

      executor.notifyNewRun();
      await flushPromises();

      expect(mockEnsureUserExists).toHaveBeenCalledWith('proj_test001', 'tester_tester_001');
      executor.stop();
    });
  });

  describe('cancellation (async)', () => {
    it('signals cancellation for a run', async () => {
      vi.clearAllMocks();
      process.env.TESTING_SCHEDULER_ENABLED = 'true';
      defaultMocks();
      const executor = createExecutor();

      executor.signalCancel('srun_test001');
      executor.notifyNewRun();
      expect(mockFindQueuedRuns).toHaveBeenCalled();
      executor.stop();
    });

    it('skips final status update when cancelled mid-flight', async () => {
      vi.clearAllMocks();
      process.env.TESTING_SCHEDULER_ENABLED = 'true';
      defaultMocks();
      const executor = createExecutor();

      const run = createMockRun({ testers: { tester_001: 1 } });
      mockFindQueuedRuns.mockResolvedValue([run]);

      executor.signalCancel('srun_test001');
      executor.notifyNewRun();
      await flushPromises();

      expect(mockUpdateRunStatus).not.toHaveBeenCalled();
      executor.stop();
    });
  });

  describe('concurrency config', () => {
    it('uses configured max parallel conversations', () => {
      process.env.TESTING_SCHEDULER_ENABLED = 'true';
      process.env.TESTING_MAX_PARALLEL_CONVERSATIONS = '10';
      const instance = createExecutor();
      expect(instance.getStatus().enabled).toBe(true);
      instance.stop();
    });

    it('defaults to 5 when env var not set', () => {
      process.env.TESTING_SCHEDULER_ENABLED = 'true';
      delete process.env.TESTING_MAX_PARALLEL_CONVERSATIONS;
      const instance = createExecutor();
      expect(instance.getStatus().enabled).toBe(true);
      instance.stop();
    });
  });
});
