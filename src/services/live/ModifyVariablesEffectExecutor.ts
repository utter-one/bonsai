import { injectable, inject } from 'tsyringe';
import { logger } from '../../utils/logger';
import { IsolatedScriptExecutor } from './IsolatedScriptExecutor';
import { TemplatingEngine } from './TemplatingEngine';
import type { ModifyVariablesEffect } from '../../types/actions';
import type { EffectOutcome } from './ActionsExecutor';
import type { ConversationContext } from './ConversationContextBuilder';

/**
 * Executor for the `modify_variables` effect.
 * Updates stage variables using specific operations: set, reset, add, remove.
 */
@injectable()
export class ModifyVariablesEffectExecutor {
  constructor(
    @inject(IsolatedScriptExecutor) private readonly scriptRunner: IsolatedScriptExecutor,
    @inject(TemplatingEngine) private readonly templatingEngine: TemplatingEngine,
  ) {}

  /**
   * Executes the modify_variables effect by applying all modifications to context.vars.
   * @param effect - The modify_variables effect definition
   * @param context - The current conversation context
   * @returns Effect outcome indicating whether variables were modified
   */
  async execute(effect: ModifyVariablesEffect, context: ConversationContext): Promise<EffectOutcome> {
    logger.info({ conversationId: context.conversationId, stageId: context.stage.id, modificationCount: effect.modifications.length }, `Modifying variables`);
    let hasModifiedVars = false;

    try {
      for (const modification of effect.modifications) {
        const { variableName, operation: op } = modification;
        let { value } = modification;
        value = await this.transformValue(value, context);
        switch (op) {
          case 'set': {
            context.vars[variableName] = value;
            hasModifiedVars = true;
            logger.debug({ conversationId: context.conversationId, variableName, value }, `Set variable: ${variableName}`);
            break;
          }

          case 'reset': {
            context.vars[variableName] = undefined;
            hasModifiedVars = true;
            logger.debug({ conversationId: context.conversationId, variableName }, `Reset variable: ${variableName}`);
            break;
          }

          case 'add': {
            const currentValue = context.vars[variableName];
            if (!Array.isArray(currentValue)) {
              logger.warn({ conversationId: context.conversationId, variableName, currentValue }, `Variable ${variableName} is not an array, initializing as array`);
              context.vars[variableName] = [value];
            } else {
              context.vars[variableName] = [...currentValue, value];
            }
            hasModifiedVars = true;
            logger.debug({ conversationId: context.conversationId, variableName, value }, `Added to variable array: ${variableName}`);
            break;
          }

          case 'remove': {
            const currentValue = context.vars[variableName];
            if (!Array.isArray(currentValue)) {
              logger.warn({ conversationId: context.conversationId, variableName, currentValue }, `Variable ${variableName} is not an array, cannot remove value`);
            } else {
              const newValue = currentValue.filter(item => JSON.stringify(item) !== JSON.stringify(value));
              context.vars[variableName] = newValue;
              hasModifiedVars = true;
              logger.debug({ conversationId: context.conversationId, variableName, value, removedCount: currentValue.length - newValue.length }, `Removed from variable array: ${variableName}`);
            }
            break;
          }

          default: {
            const exhaustiveCheck: never = op;
            throw new Error(`Unknown variable operation: ${exhaustiveCheck}`);
          }
        }
      }

      logger.info({ conversationId: context.conversationId, stageId: context.stage.id, modificationCount: effect.modifications.length }, `Variables modified successfully`);
    } catch (error) {
      logger.error({ conversationId: context.conversationId, stageId: context.stage.id, error: error instanceof Error ? error.message : String(error) }, `Failed to modify variables`);
      throw error;
    }

    return {
      shouldEndConversation: false,
      shouldAbortConversation: false,
      hasModifiedVars,
    };
  }

  /**
   * Transforms a modification value: resolves tool result references, executes inline scripts,
   * or renders Handlebars templates.
   * @param value - The raw value from the modification definition
   * @param context - The current conversation context
   * @returns The resolved value
   */
  private async transformValue(value: unknown, context: ConversationContext): Promise<unknown> {
    if (typeof value === 'string') {
      const toolResultPattern = /\{\{results\.tools\.([^.]+)\.result\}\}/;
      const match = value.match(toolResultPattern);
      if (match) {
        logger.info({ conversationId: context.conversationId, toolId: match[1] }, `Resolving value from tool result reference for tool ID: ${match[1]}`);
        const toolId = match[1];
        value = context.results.tools[toolId]?.result;
        if (Array.isArray(value)) value = value[0];
      } else if (value[0] === '=') {
        value = await this.scriptRunner.executeScript(value.slice(1).trim(), context);
      } else {
        value = await this.templatingEngine.render(value, context);
      }
    }
    return value;
  }
}
