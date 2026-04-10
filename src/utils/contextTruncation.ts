import { estimateTokenCount } from 'tokenx';
import type { LlmMessage } from '../services/providers/llm/ILlmProvider';

/**
 * Truncation state returned alongside the processed message array.
 */
export type TruncationInfo = {
  /** Whether any messages were dropped to fit within the token budget */
  truncated: boolean;
  /** Heuristic estimate of the original input token count before truncation; undefined when no cap was configured */
  estimatedInputTokens: number | undefined;
  /** Heuristic estimate of the input token count after truncation; equals estimatedInputTokens when no messages were dropped; undefined when no cap was configured */
  estimatedFinalInputTokens: number | undefined;
};

/**
 * Combined result of a truncation pass: the (possibly trimmed) message array plus truncation metadata.
 */
export type TruncationResult = {
  messages: LlmMessage[];
  /** Whether any messages were dropped to fit within the token budget */
  truncated: boolean;
  /** Heuristic estimate of the original input token count before truncation; undefined when no cap was configured */
  estimatedInputTokens: number | undefined;
  /** Heuristic estimate of the input token count after truncation; equals estimatedInputTokens when no messages were dropped; undefined when no cap was configured */
  estimatedFinalInputTokens: number | undefined;
};

/**
 * Truncates a message array to fit within the specified input token budget.
 *
 * Behaviour:
 * - Returns the array unchanged if `maxInputTokens` is undefined.
 * - Preserves the system message at index 0 unconditionally.
 * - Removes the oldest non-system messages from the front of history until the
 *   estimated token count is within budget.
 * - Always keeps at least the system message and the last user message.
 *
 * Token estimation uses heuristic character-based counting (via tokenx) rather
 * than a model-specific tokenizer. The `model` parameter is accepted for future
 * compatibility but does not currently influence counting.
 *
 * @param messages - The full message array (index 0 is expected to be the system message)
 * @param maxInputTokens - Token budget; no truncation occurs when undefined
 * @param _model - Model name (currently unused; reserved for future model-aware counting)
 * @returns Result containing the (possibly trimmed) message array and truncation metadata
 */
export function truncateMessagesToTokenBudget(messages: LlmMessage[], maxInputTokens: number | undefined, _model: string | undefined): TruncationResult {
  if (maxInputTokens === undefined || messages.length === 0) return { messages, truncated: false, estimatedInputTokens: undefined, estimatedFinalInputTokens: undefined };

  const estimateMessage = (m: LlmMessage): number => {
    const text = typeof m.content === 'string' ? m.content : m.content.map(c => ('text' in c ? c.text : '')).join(' ');
    return estimateTokenCount(text);
  };

  let total = messages.reduce((sum, m) => sum + estimateMessage(m), 0);
  if (total <= maxInputTokens) return { messages, truncated: false, estimatedInputTokens: total, estimatedFinalInputTokens: total };

  // messages[0] is system, messages[messages.length - 1] is the latest user message.
  // Middle messages are history entries that can be trimmed from oldest (index 1) forward.
  const system = messages[0];
  const last = messages[messages.length - 1];
  const originalTotal = total;

  if (messages.length <= 2) {
    // Only system + one user message: cannot trim further, return as-is
    return { messages, truncated: false, estimatedInputTokens: originalTotal, estimatedFinalInputTokens: originalTotal };
  }

  // Drop oldest middle messages one at a time, subtracting their token count each step.
  let start = 1; // inclusive index of the oldest remaining middle message
  const end = messages.length - 1; // exclusive — last is always kept
  while (start < end) {
    total -= estimateMessage(messages[start]);
    start++;
    if (total <= maxInputTokens) return { messages: [system, ...messages.slice(start, end), last], truncated: true, estimatedInputTokens: originalTotal, estimatedFinalInputTokens: total };
  }

  // Still over budget with just system + last — return minimum viable array
  return { messages: [system, last], truncated: true, estimatedInputTokens: originalTotal, estimatedFinalInputTokens: total };
}
