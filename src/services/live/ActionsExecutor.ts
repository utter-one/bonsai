import { injectable, inject } from 'tsyringe';
import { logger } from '../../utils/logger';
import { IsolatedScriptExecutor } from './IsolatedScriptExecutor';
import { TemplatingEngine } from './TemplatingEngine';
import { ToolService } from '../ToolService';
import { ToolExecutor } from './ToolExecutor';
import type { AbortConversationEffect, CallToolEffect, CallWebhookEffect, EndConversationEffect, GenerateResponseEffect, GoToStageEffect, ModifyUserInputEffect, ModifyUserProfileEffect, ModifyVariablesEffect, Effect, RunScriptEffect, StageAction, LifecycleContext } from '../../types/actions';
import { LIFECYCLE_EFFECT_RESTRICTIONS } from '../../types/actions';
import type { GlobalAction } from '../../types/models';
import { ConversationContext, ConversationContextBuilder } from './ConversationContextBuilder';
import { NotFoundError } from '../../errors';
import { ParameterValue } from '../../types/parameters';

/**
 * Execution result for an action
 */
export type ActionsExecutionOutcome = {
  success: boolean;
  shouldEndConversation: boolean;
  endReason?: string;
  shouldAbortConversation: boolean;
  abortReason?: string;
  shouldGenerateResponse: boolean;
  prescriptedResponse?: string;
  hasModifiedVars: boolean;
  hasModifiedUserInput: boolean;
  hasModifiedUserProfile: boolean;
  goToStageId?: string;
  error?: string;
  toolCallEvents?: Array<{
    toolId: string;
    toolName: string;
    parameters: Record<string, any>;
    success: boolean;
    result?: any;
    error?: string;
    systemPrompt?: string;
    llmSettings?: any;
  }>;
};

/**
 * Outcome of an effect execution
 */
export type EffectOutcome = {
  shouldEndConversation: boolean;
  endReason?: string;
  shouldAbortConversation: boolean;
  abortReason?: string;
  shouldGenerateResponse?: boolean;
  prescriptedResponse?: string;
  hasModifiedVars?: boolean;
  hasModifiedUserInput?: boolean;
  hasModifiedUserProfile?: boolean;
  newStageId?: string;
  toolCallEvent?: {
    toolId: string;
    toolName: string;
    parameters: Record<string, any>;
    success: boolean;
    result?: any;
    error?: string;
    systemPrompt?: string;
    llmSettings?: any;
  };
};

/**
 * Effect with its source action for tracking
 */
type EffectWithSource = {
  effect: Effect;
  actionName: string;
  actionIndex: number;
};


/**
 * Service responsible for executing effects defined in stage actions and global actions
 * Handles all effect types: end_conversation, abort_conversation, go_to_stage, run_script, modify_user_input, call_tool
 */
@injectable()
export class ActionsExecutor {
  constructor(
    @inject(IsolatedScriptExecutor) private readonly scriptRunner: IsolatedScriptExecutor,
    @inject(ToolService) private readonly toolService: ToolService,
    @inject(ToolExecutor) private readonly toolExecutor: ToolExecutor,
    @inject(ConversationContextBuilder) private readonly contextBuilder: ConversationContextBuilder,
    @inject(TemplatingEngine) private readonly templatingEngine: TemplatingEngine,
  ) { }

  /**
   * Helper method to extract action name from StageAction or GlobalAction
   */
  private getActionName(action: StageAction | GlobalAction): string {
    if ('id' in action && 'version' in action) {
      // It's a GlobalAction
      return (action as GlobalAction).name;
    }
    // It's a StageAction
    return (action as StageAction).name;
  }

  /**
   * Gets the execution priority for an effect type
   * Lower numbers execute first
   * @param effect - The effect to get priority for
   * @returns Priority number (1-7)
   */
  private getEffectPriority(effect: Effect): number {
    switch (effect.type) {
      case 'call_webhook':
        return 1;
      case 'call_tool':
        return 2;
      case 'modify_variables':
        return 3;
      case 'modify_user_profile':
        return 4;
      case 'modify_user_input':
        return 5;
      case 'run_script':
        return 6;
      case 'generate_response':
        return 7;
      case 'end_conversation':
        return 8;
      case 'abort_conversation':
        return 9;
      case 'go_to_stage':
        return 10;
      default:
        return 999; // Unknown effects execute last
    }
  }

  /**
   * Detects and resolves conflicts between effects
   * @param effects - Array of effects to check for conflicts
   * @returns Resolved effects with conflicts handled
   */
  private resolveEffectConflicts(effects: EffectWithSource[]): EffectWithSource[] {
    const resolvedEffects: EffectWithSource[] = [];
    const conflicts: string[] = [];

    // Group effects by type for conflict detection
    const goToStageOps = effects.filter(op => op.effect.type === 'go_to_stage');
    const endConversationOps = effects.filter(op => op.effect.type === 'end_conversation');
    const abortConversationOps = effects.filter(op => op.effect.type === 'abort_conversation');
    const modifyUserInputOps = effects.filter(op => op.effect.type === 'modify_user_input');

    // Conflict 1: Multiple go_to_stage effects with different stage IDs
    if (goToStageOps.length > 1) {
      const stageIds = goToStageOps.map(op => (op.effect as Extract<Effect, { type: 'go_to_stage' }>).stageId);
      const uniqueStageIds = new Set(stageIds);

      if (uniqueStageIds.size > 1) {
        // Multiple different stage IDs - keep only the first one
        const firstOp = goToStageOps[0];
        conflicts.push(`Multiple go_to_stage effects with different IDs detected (${Array.from(uniqueStageIds).join(', ')}). Using first: ${(firstOp.effect as Extract<Effect, { type: 'go_to_stage' }>).stageId} from action "${firstOp.actionName}"`);

        // Remove all but the first go_to_stage effect
        const otherOps = effects.filter(op => op.effect.type !== 'go_to_stage');
        resolvedEffects.push(...otherOps, firstOp);
      } else {
        // Same stage ID - keep only one instance
        conflicts.push(`Multiple go_to_stage effects with same ID detected. Using first occurrence from action "${goToStageOps[0].actionName}"`);
        const otherOps = effects.filter(op => op.effect.type !== 'go_to_stage');
        resolvedEffects.push(...otherOps, goToStageOps[0]);
      }
    } else {
      resolvedEffects.push(...effects);
    }

    // Conflict 2: Both abort_conversation and end_conversation present
    if (abortConversationOps.length > 0 && endConversationOps.length > 0) {
      // Abort takes precedence - remove all end_conversation effects
      const firstAbort = abortConversationOps[0];
      conflicts.push(`Both abort_conversation and end_conversation detected. Prioritizing abort_conversation from action "${firstAbort.actionName}" - conversation will abort immediately`);

      resolvedEffects.splice(0, resolvedEffects.length);
      resolvedEffects.push(...effects.filter(op => op.effect.type !== 'end_conversation'));
    }

    // Conflict 3: Multiple abort_conversation effects
    if (abortConversationOps.length > 1) {
      const firstAbort = abortConversationOps[0];
      conflicts.push(`Multiple abort_conversation effects detected. Using first from action "${firstAbort.actionName}"`);

      resolvedEffects.splice(0, resolvedEffects.length);
      const otherOps = effects.filter(op => op.effect.type !== 'abort_conversation');
      resolvedEffects.push(...otherOps, firstAbort);
    }

    // Conflict 4: Multiple end_conversation effects
    if (endConversationOps.length > 1 && abortConversationOps.length === 0) {
      const firstEnd = endConversationOps[0];
      conflicts.push(`Multiple end_conversation effects detected. Using first from action "${firstEnd.actionName}"`);

      if (resolvedEffects.length === 0) {
        resolvedEffects.push(...effects);
      }
      const otherOps = resolvedEffects.filter(op => op.effect.type !== 'end_conversation');
      resolvedEffects.splice(0, resolvedEffects.length);
      resolvedEffects.push(...otherOps, firstEnd);
    }

    // Conflict 5: Multiple modify_user_input effects - this is NOT a conflict, they chain
    if (modifyUserInputOps.length > 1) {
      logger.debug(`Multiple modify_user_input effects detected (${modifyUserInputOps.length}). These will chain - each modifying the result of the previous`);
    }

    // Log all conflicts detected
    if (conflicts.length > 0) {
      logger.warn({ conflicts }, `Resolved ${conflicts.length} effect conflict(s)`);
    }

    return resolvedEffects.length > 0 ? resolvedEffects : effects;
  }

  /**
   * Executes all effects for a list of actions
   * Gathers all effects from all actions, sorts by priority, resolves conflicts, and executes in order
   * @param actions - Array of actions to execute (can be stage actions or global actions)
   * @param context - Execution context
   * @param lifecycleContext - Optional lifecycle context for effect filtering (on_enter, on_leave, on_fallback)
   * @returns Array of execution results for each action
   */
  async executeActions(
    actions: (StageAction | GlobalAction)[],
    context: ConversationContext,
    lifecycleContext: LifecycleContext = null
  ): Promise<ActionsExecutionOutcome> {
    logger.info({ conversationId: context.conversationId, actionCount: actions.length, lifecycleContext }, `Executing ${actions.length} action(s)`);

    // If no actions, return early and generate response
    if (actions.length === 0) {
      logger.info({ conversationId: context.conversationId }, `No actions to execute`);
      return {
        success: true,
        shouldEndConversation: false,
        shouldAbortConversation: false,
        shouldGenerateResponse: true,
        hasModifiedVars: false,
        hasModifiedUserInput: false,
        hasModifiedUserProfile: false,
      };
    }

    // Gather all effects from all actions with their source information
    const allEffects: EffectWithSource[] = [];
    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      const actionName = this.getActionName(action);

      for (const effect of action.effects) {
        allEffects.push({
          effect,
          actionName,
          actionIndex: i,
        });
      }
    }

    logger.info({ conversationId: context.conversationId, totalEffects: allEffects.length }, `Gathered ${allEffects.length} effect(s) from ${actions.length} action(s)`);

    // Filter out effects that are restricted in this lifecycle context
    let filteredEffects = allEffects;
    if (lifecycleContext && LIFECYCLE_EFFECT_RESTRICTIONS[lifecycleContext]) {
      const restrictedEffects = LIFECYCLE_EFFECT_RESTRICTIONS[lifecycleContext];
      const beforeFilterCount = allEffects.length;
      filteredEffects = allEffects.filter(({ effect, actionName }) => {
        if (restrictedEffects.has(effect.type)) {
          logger.debug({ conversationId: context.conversationId, lifecycleContext, effectType: effect.type, actionName }, `Ignoring unsupported effect ${effect.type} in lifecycle context ${lifecycleContext}`);
          return false;
        }
        return true;
      });
      const filteredCount = beforeFilterCount - filteredEffects.length;
      if (filteredCount > 0) {
        logger.info({ conversationId: context.conversationId, lifecycleContext, filteredCount }, `Filtered ${filteredCount} unsupported effect(s) for lifecycle context ${lifecycleContext}`);
      }
    }

    // Sort all effects by priority (lower numbers execute first)
    let sortedEffects = filteredEffects.sort(
      (a, b) => this.getEffectPriority(a.effect) - this.getEffectPriority(b.effect)
    );

    // Resolve conflicts between effects
    sortedEffects = this.resolveEffectConflicts(sortedEffects);

    logger.debug({ conversationId: context.conversationId, effectOrder: sortedEffects.map(op => ({ type: op.effect.type, action: op.actionName })) }, `Executing effects in global priority order after conflict resolution`);

    // Track results
    const outcome: ActionsExecutionOutcome = {
      success: true,
      shouldEndConversation: false,
      shouldAbortConversation: false,
      shouldGenerateResponse: false,
      hasModifiedVars: false,
      hasModifiedUserInput: false,
      hasModifiedUserProfile: false,
      toolCallEvents: [],
    };

    let currentContext = context;
    let shouldStop = false;

    // Execute all effects in priority order
    for (const { effect, actionName, actionIndex } of sortedEffects) {
      if (shouldStop) {
        logger.debug({ conversationId: context.conversationId, effectType: effect.type, actionName }, `Skipping effect due to conversation termination`);
        continue;
      }

      logger.debug({ conversationId: context.conversationId, actionName, effectType: effect.type }, `Executing effect: ${effect.type} from action: ${actionName}`);

      try {
        const effectResult = await this.executeEffect(effect, currentContext, actionName);

        // Update context with modified user input if applicable
        if (effectResult.hasModifiedUserInput) {
          outcome.hasModifiedUserInput = true;
        }

        // Update modified variables in context if applicable
        if (effectResult.hasModifiedVars) {
          outcome.hasModifiedVars = true;
        }

        // Update modified user profile in context if applicable
        if (effectResult.hasModifiedUserProfile) {
          outcome.hasModifiedUserProfile = true;
        }

        // Add tool call event if present
        if (effectResult.toolCallEvent) {
          outcome.toolCallEvents.push(effectResult.toolCallEvent);
        }

        // Check if effect resulted in stage change
        if (effectResult.newStageId) {
          outcome.goToStageId = effectResult.newStageId;
        }

        // Check if effect resulted in conversation termination
        if (effectResult.shouldEndConversation) {

          outcome.shouldEndConversation = true;
          outcome.endReason = effectResult.endReason;
          shouldStop = true;
          logger.info({ conversationId: context.conversationId, actionName, endReason: effectResult.endReason }, `Conversation will end gracefully - skipping remaining effects`);
        }

        if (effectResult.shouldGenerateResponse) {
          outcome.shouldGenerateResponse = true;
          if (effectResult.prescriptedResponse !== undefined) {
            outcome.prescriptedResponse = effectResult.prescriptedResponse;
          }
          logger.info({ conversationId: context.conversationId, actionName, prescripted: effectResult.prescriptedResponse !== undefined }, `AI response generation triggered by effect`);
        }

        if (effectResult.shouldAbortConversation) {
          outcome.shouldAbortConversation = true;
          outcome.abortReason = effectResult.abortReason;
          shouldStop = true;
          logger.info({ conversationId: context.conversationId, actionName, abortReason: effectResult.abortReason }, `Conversation will abort immediately - skipping remaining effects`);
        }
      } catch (error) {
        outcome.success = false;
        outcome.error = error instanceof Error ? error.message : String(error);
        logger.error({ conversationId: context.conversationId, actionName, effectType: effect.type, error: outcome.error }, `Failed to execute effect: ${effect.type}`);
        // Continue executing other effects even if one fails?
      }
    }

    logger.info({ conversationId: context.conversationId, executedEffects: sortedEffects.length, actionCount: actions.length }, `Completed execution of effects from ${actions.length} action(s)`);
    return outcome;
  }

  /**
   * Executes a single effect based on its type
   * @param effect - The effect to execute
   * @param runner - The conversation runner instance
   * @param context - Execution context
   * @returns Result indicating if conversation should end/abort and any modified user input
   */
  private async executeEffect(
    effect: Effect,
    context: ConversationContext,
    actionName: string,
  ): Promise<EffectOutcome> {
    switch (effect.type) {
      case 'end_conversation':
        return await this.executeEndConversation(effect, context);

      case 'abort_conversation':
        return await this.executeAbortConversation(effect, context);

      case 'go_to_stage':
        return await this.executeGoToStage(effect, context);

      case 'run_script':
        return await this.executeRunScript(effect, context);

      case 'modify_user_input':
        return await this.executeModifyUserInput(effect, context);

      case 'modify_variables':
        return await this.executeModifyVariables(effect, context);

      case 'modify_user_profile':
        return await this.executeModifyUserProfile(effect, context);

      case 'call_tool':
        return await this.executeCallTool(effect, context);

      case 'call_webhook':
        return await this.executeCallWebhook(effect, context);

      case 'generate_response':
        return await this.executeGenerateResponse(effect, context, actionName);

      default:
        throw new Error(`Unknown effect`);
    }
  }

  /**
   * Executes end_conversation effect
   */
  private async executeEndConversation(
    effect: EndConversationEffect,
    context: ConversationContext,
  ): Promise<EffectOutcome> {
    logger.info({ conversationId: context.conversationId, reason: effect.reason }, `Ending conversation gracefully`);
    return {
      shouldEndConversation: true,
      shouldAbortConversation: false,
      endReason: effect.reason,
    };
  }

  /**
   * Executes abort_conversation effect
   */
  private async executeAbortConversation(
    effect: AbortConversationEffect,
    context: ConversationContext,
  ): Promise<EffectOutcome> {
    logger.info({ conversationId: context.conversationId, reason: effect.reason }, `Aborting conversation immediately`);
    return {
      shouldEndConversation: false,
      shouldAbortConversation: true,
      abortReason: effect.reason,
    };
  }

  /**
   * Executes go_to_stage effect
   */
  private async executeGoToStage(
    effect: GoToStageEffect,
    context: ConversationContext,
  ): Promise<EffectOutcome> {
    logger.info({ conversationId: context.conversationId, targetStageId: effect.stageId, currentStageId: context.stage.id }, `Navigating to stage: ${effect.stageId}`);

    // Update context with new stage ID
    context.stage.id = effect.stageId;

    logger.info({ conversationId: context.conversationId, newStageId: effect.stageId }, `Successfully navigated to stage: ${effect.stageId}`);

    return {
      shouldEndConversation: false,
      shouldAbortConversation: false,
      newStageId: effect.stageId,
    };
  }

  /**
   * Executes run_script effect
   * Delegates to StageScriptRunner for secure script execution in isolated VM
   */
  private async executeRunScript(
    effect: RunScriptEffect,
    context: ConversationContext,
  ): Promise<EffectOutcome> {
    logger.info({ effect, context }, `Executing run_script effect`);
    await this.scriptRunner.executeScript(effect.code, context);

    return {
      shouldEndConversation: false,
      shouldAbortConversation: false,
    };
  }

  /**
   * Executes modify_user_input effect
   * Renders a template using TemplatingEngine and replaces the user input with it
   */
  private async executeModifyUserInput(
    effect: ModifyUserInputEffect,
    context: ConversationContext,
  ): Promise<EffectOutcome> {
    logger.info({ conversationId: context.conversationId, originalInput: context.userInput, template: effect.template }, `Modifying user input`);

    try {
      // Render the template using the templating engine with full context
      const modifiedInput = await this.templatingEngine.render(effect.template, context);

      logger.info({ conversationId: context.conversationId, originalInput: context.userInput, modifiedInput }, `User input modified`);
      context.userInput = modifiedInput;

      return {
        shouldEndConversation: false,
        shouldAbortConversation: false,
        hasModifiedUserInput: true,
      };
    } catch (error) {
      logger.error({ conversationId: context.conversationId, error: error instanceof Error ? error.message : String(error) }, `Failed to modify user input`);
      throw error;
    }
  }

  /**
   * Executes modify_variables effect
   * Updates stage variables using specific operations (set, reset, add, remove)
   */
  private async executeModifyVariables(
    effect: ModifyVariablesEffect,
    context: ConversationContext,
  ): Promise<EffectOutcome> {
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
   * Executes modify_user_profile effect
   * Updates user profile fields using specific operations (set, reset, add, remove)
   */
  private async executeModifyUserProfile(
    effect: ModifyUserProfileEffect,
    context: ConversationContext,
  ): Promise<EffectOutcome> {
    logger.info({ conversationId: context.conversationId, modificationCount: effect.modifications.length }, `Modifying user profile`);
    let hasModifiedUserProfile = false;

    try {
      for (const modification of effect.modifications) {
        let { fieldName, value } = modification;
        value = await this.transformValue(value, context);

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

  private async transformValue(value: unknown, context: ConversationContext) {
    if (typeof value === 'string') {
      // check if the string is a reference to tool result {{results.tools.TOOL_ID.result}} and if so, skip templating
      const toolResultPattern = /\{\{results\.tools\.([^.]+)\.result\}\}/;
      const match = value.match(toolResultPattern);
      if (match) {
        logger.info({ conversationId: context.conversationId, toolId: match[1] }, `Resolving value from tool result reference for tool ID: ${match[1]}`);
        const toolId = match[1];
        value = context.results.tools[toolId]?.result;
      } else {
        value = await this.templatingEngine.render(value, context);
      }
    }
    return value;
  }

  /**
   * Parses a `{{vars.x.y.z}}` template expression and returns the variable path (e.g. `"vars.x.y.z"`),
   * or `null` if the value is not a vars reference.
   * @param value - Raw parameter value string to inspect
   */
  private parseVarsReference(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (trimmed.startsWith('{{') && trimmed.endsWith('}}')) {
      const inner = trimmed.slice(2, -2).trim();
      if (inner.startsWith('vars.') || inner === 'vars') {
        return inner;
      }
    }
    return null;
  }

  /**
   * Resolves a dotted variable path (e.g. `"vars.foo.bar"`) against the conversation vars.
   * The leading `"vars."` segment is stripped before traversal.
   * @param vars - Stage variables from the conversation context
   * @param path - Dotted path string starting with `"vars."`
   * @returns The resolved value, or `undefined` if any segment is missing
   */
  private resolveVarPath(vars: Record<string, any>, path: string): unknown {
    const withoutPrefix = path.startsWith('vars.') ? path.slice(5) : path;
    if (!withoutPrefix) return vars;
    const parts = withoutPrefix.split('.');
    let current: any = vars;
    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== 'object') return undefined;
      current = current[part];
    }
    return current;
  }

  /**
   * Resolves and validates an image value read from a stage variable.
   * Logs a warning if the value does not conform to the ImageParameterValue shape.
   * @param value - The variable value to validate
   * @param paramName - Parameter name used in log messages
   * @param varPath - Variable path used in log messages
   * @param conversationId - Conversation ID used in log messages
   * @param toolId - Tool ID used in log messages
   */
  private validateImageVarValue(value: unknown, paramName: string, varPath: string, conversationId: string, toolId: string): void {
    if (!value || typeof value !== 'object' || !('data' in value) || !('mimeType' in value) || typeof (value as any).mimeType !== 'string' || !(value as any).mimeType.startsWith('image/')) {
      logger.warn({ conversationId, toolId, parameterName: paramName, variablePath: varPath }, `Image parameter ${paramName} resolved from ${varPath} does not match ImageParameterValue schema (expected { data, mimeType })`);
    }
  }

  /**
   * Resolves all call_tool effect parameters:
   * - Parameters whose tool definition type is `image` or `image[]` are resolved from stage
   *   variables referenced as `{{vars.path.to.value}}` expressions.
   * - All other string parameters are rendered through the templating engine.
   * - Non-string, non-image values are passed through unchanged.
   * @param effectParameters - Raw parameters from the CallToolEffect
   * @param toolParameterTypes - Map of parameter name → expected type from tool definition
   * @param context - Conversation context (provides vars and templating data)
   * @param toolId - Tool ID used in log messages
   * @returns Resolved parameters ready to pass to ToolExecutor
   */
  private async resolveToolParameters(
    effectParameters: Record<string, unknown>,
    toolParameterTypes: Map<string, string>,
    context: ConversationContext,
    toolId: string,
  ): Promise<Record<string, ParameterValue>> {
    const resolved: Record<string, ParameterValue> = {};

    for (const [key, value] of Object.entries(effectParameters)) {
      const paramType = toolParameterTypes.get(key);
      const isImageParam = paramType === 'image' || paramType === 'image[]';

      if (isImageParam && typeof value === 'string') {
        // Resolve image from stage variable reference {{vars.x.y.z}}
        const varPath = this.parseVarsReference(value);
        if (varPath !== null) {
          const varValue = this.resolveVarPath(context.vars, varPath);
          if (varValue === undefined) {
            logger.warn({ conversationId: context.conversationId, toolId, parameterName: key, variablePath: varPath }, `Image parameter ${key} references variable path ${varPath} which is not set in context.vars`);
            resolved[key] = value as ParameterValue;
          } else if (paramType === 'image[]' && Array.isArray(varValue)) {
            for (const [index, item] of varValue.entries()) {
              this.validateImageVarValue(item, `${key}[${index}]`, varPath, context.conversationId, toolId);
            }
            resolved[key] = varValue as ParameterValue;
            logger.debug({ conversationId: context.conversationId, toolId, parameterName: key, variablePath: varPath, itemCount: varValue.length }, `Resolved image[] parameter ${key} from variable ${varPath}`);
          } else {
            this.validateImageVarValue(varValue, key, varPath, context.conversationId, toolId);
            resolved[key] = varValue as ParameterValue;
            logger.debug({ conversationId: context.conversationId, toolId, parameterName: key, variablePath: varPath }, `Resolved image parameter ${key} from variable ${varPath}`);
          }
        } else {
          logger.warn({ conversationId: context.conversationId, toolId, parameterName: key }, `Image parameter ${key} value is not a {{vars.*}} reference; passing through as-is`);
          resolved[key] = value as ParameterValue;
        }
      } else if (typeof value === 'string') {
        // Render text parameters through the templating engine
        resolved[key] = await this.templatingEngine.render(value, context);
      } else {
        resolved[key] = value as ParameterValue;
      }
    }

    return resolved;
  }

  /**
   * Executes call_tool effect
   * Calls a tool with the specified parameters and stores the result
   */
  private async executeCallTool(
    effect: CallToolEffect,
    context: ConversationContext,
  ): Promise<EffectOutcome> {
    logger.info({ context, toolId: effect.toolId, parameterCount: Object.keys(effect.parameters).length }, `Calling tool: ${effect.toolId}`);

    try {
      // 1. Load the tool
      const tool = await this.toolService.getToolById(effect.toolId);
      if (!tool) {
        throw new NotFoundError(`Tool with ID ${effect.toolId} not found`);
      }

      logger.debug({ conversationId: context.conversationId, toolId: effect.toolId, toolName: tool.name, inputType: tool.inputType, outputType: tool.outputType }, `Tool loaded: ${tool.name}`);

      // 2. Build a map of parameter name → expected type from the tool definition
      const toolParameterTypes = new Map<string, string>();
      for (const param of (tool.parameters || [])) {
        toolParameterTypes.set(param.name, param.type);
      }

      // 3. Resolve parameters:
      //    - image / image[] typed parameters are resolved from {{vars.x.y.z}} stage variable references
      //    - all other string parameters are rendered through the templating engine
      const resolvedParameters = await this.resolveToolParameters(effect.parameters, toolParameterTypes, context, effect.toolId);

      logger.debug({ conversationId: context.conversationId, toolId: effect.toolId, parameters: resolvedParameters }, `Input parameters resolved for tool`);

      // 4. Execute the tool using ToolExecutor
      // ToolExecutor will:
      // - Load the LLM provider
      // - Render the tool prompt with context and parameters
      // - Call the LLM
      // - Return the result
      const executionResult = await this.toolExecutor.executeTool(tool as any, context, resolvedParameters);

      if (!executionResult.success) {
        throw new Error(executionResult.failureReason || 'Tool execution failed');
      }

      logger.debug({ conversationId: context.conversationId, toolId: effect.toolId, hasResult: !!executionResult.result }, `Tool executed successfully`);

      // 4. Validate output against tool.outputType
      // Check that the result format matches what we expect
      if (executionResult.result !== undefined && executionResult.result !== null) {

        if (tool.outputType === 'text') {
          // For text output, result should be a string or easily convertible
          if (!executionResult.result.every(x => x.contentType === 'text')) {
            logger.warn({ conversationId: context.conversationId, toolId: effect.toolId }, `Tool output type is '${tool.outputType}' but result contains non-text content, will convert to string`);
          }
        } else if (tool.outputType === 'image') {
          if (!executionResult.result.every(x => x.contentType === 'image')) {
            logger.warn({ conversationId: context.conversationId, toolId: effect.toolId }, `Tool output type is '${tool.outputType}' but result contains non-image content`);
          }
        }
        // For 'multi-modal', we accept any format
      }

      // 5. Store the result in context.results.tools
      if (!context.results) {
        context.results = { webhooks: {}, tools: {} };
      }
      if (!context.results.tools) {
        context.results.tools = {};
      }

      context.results.tools[tool.id] = {
        toolId: tool.id,
        toolName: tool.name,
        inputType: tool.inputType,
        outputType: tool.outputType,
        parameters: resolvedParameters,
        result: executionResult.result,
        executedAt: new Date().toISOString(),
      };

      logger.info({ conversationId: context.conversationId, toolId: effect.toolId, toolName: tool.name }, `Tool called successfully and result stored: ${tool.name}`);

      // Return tool call event data so caller can save/send it
      return {
        shouldEndConversation: false,
        shouldAbortConversation: false,
        toolCallEvent: {
          toolId: tool.id,
          toolName: tool.name,
          parameters: resolvedParameters,
          success: executionResult.success,
          result: executionResult.result,
          error: executionResult.failureReason,
          systemPrompt: executionResult.renderedPrompt,
          llmSettings: executionResult.llmSettings
        }
      };
    } catch (error) {
      logger.error({ conversationId: context.conversationId, toolId: effect.toolId, error: error instanceof Error ? error.message : String(error) }, `Failed to call tool`);
      throw error;
    }
  }

  /**
   * Executes call_webhook effect
   * Calls an HTTP(S) endpoint and stores the result in conversation context
   */
  private async executeCallWebhook(
    effect: CallWebhookEffect,
    context: ConversationContext,
  ): Promise<EffectOutcome> {
    logger.info({ conversationId: context.conversationId, url: effect.url, method: effect.method || 'GET', resultKey: effect.resultKey }, `Calling webhook: ${effect.url}`);

    try {
      // Render URL through templating engine
      const renderedUrl = await this.templatingEngine.render(effect.url, context);

      // Render headers through templating engine
      const renderedHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (effect.headers) {
        for (const [key, value] of Object.entries(effect.headers)) {
          renderedHeaders[key] = await this.templatingEngine.render(value, context);
        }
      }

      // Prepare fetch options
      const fetchOptions: RequestInit = {
        method: effect.method || 'GET',
        headers: renderedHeaders,
      };

      // Add body for POST/PUT/PATCH requests
      if (effect.body && ['POST', 'PUT', 'PATCH'].includes(effect.method || 'GET')) {
        // Render body through templating engine
        const bodyString = typeof effect.body === 'string' ? effect.body : JSON.stringify(effect.body);
        const renderedBody = await this.templatingEngine.render(bodyString, context);
        fetchOptions.body = renderedBody;
      }

      // Make the HTTP request
      const response = await fetch(renderedUrl, fetchOptions);

      // Parse response
      let result: any;
      const contentType = response.headers.get('content-type');
      if (contentType?.includes('application/json')) {
        result = await response.json();
      } else {
        result = await response.text();
      }

      // Store result in context
      if (!context.results) {
        context.results = { webhooks: {}, tools: {} };
      }
      if (!context.results.webhooks) {
        context.results.webhooks = {};
      }

      // Convert headers to plain object
      const headersObj: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headersObj[key] = value;
      });

      context.results.webhooks[effect.resultKey] = {
        status: response.status,
        statusText: response.statusText,
        headers: headersObj,
        data: result,
      };

      logger.info({ conversationId: context.conversationId, url: effect.url, status: response.status, resultKey: effect.resultKey }, `Webhook called successfully and result stored`);
    } catch (error) {
      logger.error({ conversationId: context.conversationId, url: effect.url, error: error instanceof Error ? error.message : String(error) }, `Failed to call webhook`);
      throw error;
    }

    return {
      shouldEndConversation: false,
      shouldAbortConversation: false,
    };
  }

  /**
   * Executes generate_response effect.
   * For 'generated' mode, sets the flag to trigger AI response generation.
   * For 'prescripted' mode, selects a response from prescriptedResponses using the configured strategy
   * (random or round_robin) and stores the selected text on the outcome to bypass LLM generation.
   * Round-robin state is persisted in stage variables using a reserved key.
   */
  private async executeGenerateResponse(
    effect: GenerateResponseEffect,
    context: ConversationContext,
    actionName: string,
  ): Promise<EffectOutcome> {
    const responseMode = effect.responseMode ?? 'generated';

    if (responseMode === 'prescripted') {
      const responses = effect.prescriptedResponses;
      if (!responses || responses.length === 0) {
        logger.warn({ conversationId: context.conversationId }, `Prescripted response mode is set but no prescriptedResponses provided — falling back to AI generation`);
        return { shouldEndConversation: false, shouldAbortConversation: false, shouldGenerateResponse: true };
      }

      const strategy = effect.prescriptedSelectionStrategy ?? 'random';
      let selectedIndex: number;
      let hasModifiedVars = false;

      if (strategy === 'round_robin') {
        const rrKey = `__prescripted_rr_${actionName}`;
        const currentIndex = typeof context.vars[rrKey] === 'number' ? (context.vars[rrKey] as number) : -1;
        selectedIndex = (currentIndex + 1) % responses.length;
        context.vars[rrKey] = selectedIndex;
        hasModifiedVars = true;
        logger.info({ conversationId: context.conversationId, strategy, actionName, selectedIndex, total: responses.length }, `Prescripted response selected via round_robin`);
      } else {
        selectedIndex = Math.floor(Math.random() * responses.length);
        logger.info({ conversationId: context.conversationId, strategy, actionName, selectedIndex, total: responses.length }, `Prescripted response selected via random`);
      }

      const prescriptedResponse = responses[selectedIndex];
      return {
        shouldEndConversation: false,
        shouldAbortConversation: false,
        shouldGenerateResponse: true,
        prescriptedResponse,
        hasModifiedVars,
      };
    }

    logger.info({ conversationId: context.conversationId }, `Setting flag to generate AI response`);
    return {
      shouldEndConversation: false,
      shouldAbortConversation: false,
      shouldGenerateResponse: true,
    };
  }
}
