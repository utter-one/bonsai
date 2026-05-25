import { injectable, inject } from 'tsyringe';
import { eq, and } from 'drizzle-orm';
import { db } from '../../db/index';
import { conversations, contextTransformers, providers, type EvaluationComparisonMode } from '../../db/schema';
import { LlmProviderFactory } from '../providers/llm/LlmProviderFactory';
import { extractTextFromContent } from '../../utils/llm';
import { parseJsonFromMarkdown } from '../../utils/jsonParser';
import { logger } from '../../utils/logger';
import type { ScenarioResponse } from '../../http/contracts/scenario';

const comparisonModes: EvaluationComparisonMode[] = ['exists', 'not_exists', 'eq', 'contains', 'includes', 'matches', 'gt', 'gte', 'lt', 'lte', 'in', 'nin'];

/** Result of evaluating a single scenario conversation post-run */
export type EvaluationResult = {
  /** Extracted stage variable values keyed by varName */
  dataExtractionResults: Record<string, unknown>;
  /** Post-processed transformation results, null if no transformer is configured */
  dataTransformationResults: Record<string, unknown> | null;
  /** Whether the evaluation passed. True when no expectedValue is defined or all match. */
  passed: boolean;
};

/**
 * Evaluates a completed scenario conversation by extracting stage variables,
 * optionally applying a context transformer, and comparing results against
 * expected values defined in the scenario configuration.
 */
@injectable()
export class ScenarioConversationEvaluator {
  constructor(@inject(LlmProviderFactory) private readonly llmProviderFactory: LlmProviderFactory) {}

  /**
   * Evaluates a completed scenario conversation.
   * @param conversationId - ID of the completed conversation
   * @param projectId - Project the conversation belongs to
   * @param scenario - Scenario configuration with data extraction and expected values
   * @returns Evaluation results including extracted data, transformation output, and pass/fail
   */
  async evaluate(conversationId: string, projectId: string, scenario: ScenarioResponse): Promise<EvaluationResult> {
    logger.info({ conversationId, scenarioId: scenario.id }, 'Evaluating scenario conversation');

    const conversation = await db.query.conversations.findFirst({ where: and(eq(conversations.id, conversationId), eq(conversations.projectId, projectId)) });

    if (!conversation) {
      logger.warn({ conversationId }, 'Conversation not found during evaluation, returning empty results');
      return { dataExtractionResults: {}, dataTransformationResults: null, passed: false };
    }

    const stageVars: Record<string, Record<string, unknown>> = (conversation.stageVars as Record<string, Record<string, unknown>>) ?? {};
    const dataExtractionResults: Record<string, unknown> = {};

    for (const entry of (scenario.dataExtraction ?? [])) {
      const stageVariables = stageVars[entry.stageId] ?? {};
      dataExtractionResults[entry.varName] = stageVariables[entry.varName] ?? null;
    }

    let dataTransformationResults: Record<string, unknown> | null = null;

    if (scenario.contextTransformerId) {
      dataTransformationResults = await this.applyContextTransformer(scenario.contextTransformerId, projectId, dataExtractionResults, conversationId);
    }

    const extractionExpectations = (scenario.dataExtraction ?? []).reduce((acc, e) => {
      acc[e.varName] = { value: e.expectedValue, mode: e.expectedMode };
      return acc;
    }, {} as Record<string, { value?: unknown; mode?: EvaluationComparisonMode }>);

    const passed = this.checkExpectedValues(dataExtractionResults, extractionExpectations)
      && this.checkExpectedValues(dataTransformationResults ?? {}, scenario.dataPostProcessingExpected ?? {});

    logger.info({ conversationId, scenarioId: scenario.id, passed }, 'Scenario conversation evaluation complete');
    return { dataExtractionResults, dataTransformationResults, passed };
  }

  /**
   * Runs the context transformer against the extracted data to produce post-processed results.
   * @param transformerId - ID of the context transformer to apply
   * @param projectId - Project the transformer belongs to
   * @param extractedData - The extracted stage variable values to transform
   * @param conversationId - Conversation ID for logging context
   * @returns Transformed results, or null if the transformer fails
   */
  private async applyContextTransformer(transformerId: string, projectId: string, extractedData: Record<string, unknown>, conversationId: string): Promise<Record<string, unknown> | null> {
    try {
      const transformer = await db.query.contextTransformers.findFirst({ where: and(eq(contextTransformers.id, transformerId), eq(contextTransformers.projectId, projectId)) });

      if (!transformer) {
        logger.warn({ transformerId, conversationId }, 'Context transformer not found, skipping transformation');
        return null;
      }

      if (!transformer.llmProviderId) {
        logger.warn({ transformerId, conversationId }, 'Context transformer has no LLM provider configured, skipping');
        return null;
      }

      const providerEntity = await db.query.providers.findFirst({ where: eq(providers.id, transformer.llmProviderId) });

      if (!providerEntity) {
        logger.warn({ transformerId, providerId: transformer.llmProviderId, conversationId }, 'LLM provider not found for transformer, skipping');
        return null;
      }

      const llmProvider = await this.llmProviderFactory.createProvider(providerEntity, transformer.llmSettings);
      const inputJson = JSON.stringify(extractedData, null, 2);
      const messages = [
        { role: 'system' as const, content: transformer.prompt },
        { role: 'user' as const, content: inputJson },
      ];

      const result = await llmProvider.generate(messages);
      const textContent = extractTextFromContent(result.content);
      const parsed = parseJsonFromMarkdown(textContent);

      await llmProvider.cleanup();

      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }

      logger.warn({ transformerId, conversationId }, 'Transformer returned non-object response, storing as raw string');
      return { raw: textContent };
    } catch (error) {
      logger.error({ error, transformerId, conversationId }, 'Context transformer evaluation failed, skipping');
      return null;
    }
  }

  /**
   * Checks whether the actual results match the expected values using mode-aware comparison.
   * Returns true if no expected values are configured or all defined expected values pass their assertions.
   * @param actual - Actual results (transformed or extracted)
   * @param expected - Expected values with optional mode from scenario configuration
   * @returns True if all expected values match or no expected values are defined
   */
  private checkExpectedValues(actual: Record<string, unknown>, expected: Record<string, { value?: unknown; mode?: EvaluationComparisonMode }> | null): boolean {
    if (!expected || Object.keys(expected).length === 0) return true;

    for (const [key, expectation] of Object.entries(expected)) {
      const { value: expectedValue, mode = 'eq' } = expectation;
      const actualValue = actual[key];

      if (mode === 'exists') {
        if (actualValue == null) {
          logger.debug({ key, mode }, 'Expected value to exist but was null');
          return false;
        }
      } else if (mode === 'not_exists') {
        if (actualValue != null) {
          logger.debug({ key, mode }, 'Expected value not to exist but was found');
          return false;
        }
      } else if (!comparisonModes.includes(mode)) {
        logger.warn({ key, mode }, `Unknown comparison mode "${mode}", falling back to eq`);
      }

      const result = this.compareValue(actualValue, expectedValue, mode);
      if (!result) {
        logger.debug({ key, expectedValue, actualValue, mode }, 'Expected value mismatch');
        return false;
      }
    }

    return true;
  }

  /**
   * Compares an actual value against an expected value using the specified comparison mode.
   * @param actual - The actual value to check
   * @param expectedValue - The expected value to compare against
   * @param mode - The comparison mode to use (defaults to 'eq')
   * @returns True if the comparison passes, false otherwise
   */
  private compareValue(actual: unknown, expectedValue: unknown, mode: EvaluationComparisonMode): boolean {
    switch (mode) {
      case 'exists':
        return actual != null;

      case 'not_exists':
        return actual == null;

      case 'eq':
        return JSON.stringify(actual) === JSON.stringify(expectedValue);

      case 'contains':
        if (typeof actual !== 'string' || expectedValue == null) return false;
        return actual.includes(String(expectedValue));

      case 'includes':
        if (!Array.isArray(actual)) return false;
        return actual.some(item => JSON.stringify(item) === JSON.stringify(expectedValue));

      case 'matches':
        if (!(expectedValue instanceof RegExp)) return false;
        return expectedValue.test(String(actual));

      case 'gt':
        return Number(actual) > Number(expectedValue);

      case 'gte':
        return Number(actual) >= Number(expectedValue);

      case 'lt':
        return Number(actual) < Number(expectedValue);

      case 'lte':
        return Number(actual) <= Number(expectedValue);

      case 'in':
        if (!Array.isArray(expectedValue)) return false;
        return expectedValue.some(item => JSON.stringify(item) === JSON.stringify(actual));

      case 'nin':
        if (!Array.isArray(expectedValue)) return true;
        return !expectedValue.some(item => JSON.stringify(item) === JSON.stringify(actual));

      default:
        logger.warn({ mode }, `Unreachable comparison mode`);
        return false;
    }
  }
}
