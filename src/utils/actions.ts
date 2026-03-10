import { logger } from "../utils/logger";
import { ConversationContext } from "../services/live/ConversationContextBuilder";
import { IsolatedScriptExecutor } from "../services/live/IsolatedScriptExecutor";
import { StageAction } from "../types/actions";
import { GlobalAction, Guardrail } from "../types/models";

/**
 * Utility function to evaluate if an action is active based on its condition.
 * Executes the condition script in an isolated VM with access to the conversation context.
 * Returns true if the action is active (condition is true or no condition), false otherwise.
 * @param action - The action to evaluate
 * @param rawContext - The conversation context to use for condition evaluation
 * @param scriptExecutor - The IsolatedScriptExecutor instance to run the condition script
 * @returns A promise that resolves to true if the action is active, false otherwise
 */
export async function isActionActive(action: StageAction | GlobalAction | Guardrail, rawContext: ConversationContext, scriptExecutor: IsolatedScriptExecutor): Promise<boolean> {
  if (action.condition) {
    const result = await scriptExecutor.executeScript(action.condition, rawContext);
    logger.info({ conversationId: rawContext.conversationId, condition: action.condition, stageId: rawContext.stage.id, actionName: action.name, conditionResult: !!result.value }, `Evaluated condition for action '${action.name}'`);
    return !!result.value;
  }

  return true;
}
