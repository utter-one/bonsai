import { injectable, inject } from 'tsyringe';
import { logger } from '../../utils/logger';
import { IsolatedScriptExecutor } from './IsolatedScriptExecutor';
import { TemplatingEngine } from './TemplatingEngine';
import { transformEffectValue } from './effectValueTransformer';
import type { ModifyUserProfileEffect } from '../../types/actions';
import type { EffectOutcome } from './ActionsExecutor';
import type { ConversationContext } from './ConversationContextBuilder';

/**
 * Executor for the `modify_user_profile` effect.
 * Updates user profile fields using specific operations: set, reset, add, remove.
 * Supports referencing stage variables ({{vars.x}}, {{stageVars.stage.x}}) and tool
 * results ({{results.tools.toolId.result}}) in modification values.
 */
@injectable()
export class ModifyUserProfileEffectExecutor {
  constructor(
    @inject(IsolatedScriptExecutor) private readonly scriptRunner: IsolatedScriptExecutor,
    @inject(TemplatingEngine) private readonly templatingEngine: TemplatingEngine,
  ) {}

  /**
   * Executes the modify_user_profile effect by applying all modifications to context.userProfile.
   * @param effect - The modify_user_profile effect definition
   * @param context - The current conversation context
   * @returns Effect outcome indicating whether the user profile was modified
   */
  async execute(effect: ModifyUserProfileEffect, context: ConversationContext): Promise<EffectOutcome> {
    logger.info({ conversationId: context.conversationId, modificationCount: effect.modifications.length }, `Modifying user profile`);
    let hasModifiedUserProfile = false;

    try {
      for (const modification of effect.modifications) {
        let { fieldName, value } = modification;
        logger.info({ conversationId: context.conversationId, fieldName, operation: modification.operation, value }, `Processing user profile modification`);
        value = await transformEffectValue(value, context, this.scriptRunner, this.templatingEngine);

        switch (modification.operation) {
          case 'set': {
            context.userProfile[fieldName] = value;
            hasModifiedUserProfile = true;
            logger.debug({ conversationId: context.conversationId, fieldName, value }, `Set user profile field: ${fieldName}`);
            break;
          }

          case 'reset': {
            context.userProfile[fieldName] = undefined;
            hasModifiedUserProfile = true;
            logger.debug({ conversationId: context.conversationId, fieldName }, `Reset user profile field: ${fieldName}`);
            break;
          }

          case 'add': {
            const currentValue = context.userProfile[fieldName];
            if (!Array.isArray(currentValue)) {
              logger.warn({ conversationId: context.conversationId, fieldName, currentValue }, `User profile field ${fieldName} is not an array, initializing as array`);
              context.userProfile[fieldName] = [value];
            } else {
              context.userProfile[fieldName] = [...currentValue, value];
            }
            hasModifiedUserProfile = true;
            logger.debug({ conversationId: context.conversationId, fieldName, value }, `Added to user profile array field: ${fieldName}`);
            break;
          }

          case 'remove': {
            const currentValue = context.userProfile[fieldName];
            if (!Array.isArray(currentValue)) {
              logger.warn({ conversationId: context.conversationId, fieldName, currentValue }, `User profile field ${fieldName} is not an array, cannot remove value`);
            } else {
              const newValue = currentValue.filter(item => JSON.stringify(item) !== JSON.stringify(value));
              context.userProfile[fieldName] = newValue;
              hasModifiedUserProfile = true;
              logger.debug({ conversationId: context.conversationId, fieldName, value, removedCount: currentValue.length - newValue.length }, `Removed from user profile array field: ${fieldName}`);
            }
            break;
          }

          default: {
            const exhaustiveCheck: never = modification.operation;
            throw new Error(`Unknown user profile operation: ${exhaustiveCheck}`);
          }
        }
      }

      logger.info({ conversationId: context.conversationId, modificationCount: effect.modifications.length }, `User profile modified successfully`);
    } catch (error) {
      logger.error({ conversationId: context.conversationId, error: error instanceof Error ? error.message : String(error) }, `Failed to modify user profile`);
      throw error;
    }

    return {
      shouldEndConversation: false,
      shouldAbortConversation: false,
      hasModifiedUserProfile,
    };
  }
}

