import { injectable, inject } from 'tsyringe';
import { logger } from '../../utils/logger';
import { TemplatingEngine } from './TemplatingEngine';
import { ToolService } from '../ToolService';
import { ToolExecutor } from './ToolExecutor';
import { ModifyVariablesEffectExecutor } from './ModifyVariablesEffectExecutor';
import { ModifyUserProfileEffectExecutor } from './ModifyUserProfileEffectExecutor';
import { UserService } from '../UserService';
import type { AbortConversationEffect, BanUserEffect, CallToolEffect, ChangeVisibilityEffect, EndConversationEffect, GenerateResponseEffect, GoToStageEffect, ModifyUserInputEffect, Effect, StageAction, LifecycleContext, ModifyVariablesEffect, ModifyUserProfileEffect } from '../../types/actions';
import type { MessageVisibility, ConversationEventType, ConversationEventData, ActionsExecutionPlanEventData } from '../../types/conversationEvents';
import { LIFECYCLE_EFFECT_RESTRICTIONS } from '../../types/actions';
import type { GlobalAction, Guardrail } from '../../types/models';
import type { ToolType } from '../../db/schema';
import { ConversationContext, ConversationContextBuilder } from './ConversationContextBuilder';
import { NotFoundError } from '../../errors';
import { ParameterValue } from '../../types/parameters';

/** Callback type for emitting conversation events from within effect handlers */
export type EffectEventCallback = (type: ConversationEventType, data: ConversationEventData) => Promise<void>;

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
  /** Name of the action that triggered go_to_stage, if applicable */
  goToStageSourceAction?: string;
  /** Name of the action that triggered end_conversation, if applicable */
  endConversationSourceAction?: string;
  /** Name of the action that triggered abort_conversation, if applicable */
  abortConversationSourceAction?: string;
  error?: string;
  /** Pending visibility override to apply to the current turn's messages, produced by change_visibility effects */
  turnVisibility?: MessageVisibility;
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
  /** Pending visibility override for the current turn's messages */
  turnVisibility?: MessageVisibility;
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
 * Handles all effect types: end_conversation, abort_conversation, go_to_stage, modify_user_input, call_tool
 */
@injectable()
export class ActionsExecutor {
  constructor(
    @inject(ToolService) private readonly toolService: ToolService,
    @inject(ToolExecutor) private readonly toolExecutor: ToolExecutor,
    @inject(ConversationContextBuilder) private readonly contextBuilder: ConversationContextBuilder,
    @inject(TemplatingEngine) private readonly templatingEngine: TemplatingEngine,
    @inject(ModifyVariablesEffectExecutor) private readonly modifyVariablesExecutor: ModifyVariablesEffectExecutor,
    @inject(ModifyUserProfileEffectExecutor) private readonly modifyUserProfileExecutor: ModifyUserProfileEffectExecutor,
    @inject(UserService) private readonly userService: UserService,
  ) { }

  /**
   * Helper method to extract action name from StageAction, GlobalAction, or Guardrail
   */
  private getActionName(action: StageAction | GlobalAction | Guardrail): string {
    if ('id' in action && 'version' in action) {
      // It's a GlobalAction
      return (action as GlobalAction).name;
    }
    // It's a StageAction
    return (action as StageAction).name;
  }

  /**
   * Gets the execution priority for an effect type.
   * Lower numbers execute first.
   * For call_tool effects, priority is determined by the referenced tool's type:
   * webhook tools run at priority 1, script tools at priority 6, smart_function tools at priority 2.
   * @param effect - The effect to get priority for
   * @param toolTypes - Optional map of toolId → ToolType for call_tool priority resolution
   * @returns Priority number
   */
  private getEffectPriority(effect: Effect, toolTypes?: Map<string, ToolType>): number {
    switch (effect.type) {
      case 'call_tool': {
        const toolType = toolTypes?.get((effect as CallToolEffect).toolId);
        if (toolType === 'webhook') return 1;
        if (toolType === 'script') return 6;
        return 2; // smart_function or unknown
      }
      case 'modify_variables':
        return 3;
      case 'modify_user_profile':
        return 4;
      case 'modify_user_input':
        return 5;
      case 'ban_user':
        return 7;
      case 'change_visibility':
        return 50;
      case 'generate_response':
        return 100;
      case 'end_conversation':
        return 200;
      case 'abort_conversation':
        return 201;
      case 'go_to_stage':
        return 202;
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
   * @param stageId - ID of the stage where execution is taking place
   * @param lifecycleContext - Lifecycle context for effect filtering (on_enter, on_leave, on_fallback), or null
   * @param emitEvent - Callback to emit conversation events inline as effects are applied
   * @returns Array of execution results for each action
   */
  async executeActions(
    actions: (StageAction | GlobalAction | Guardrail)[],
    context: ConversationContext,
    stageId: string,
    lifecycleContext: LifecycleContext,
    emitEvent: EffectEventCallback
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

    // Pre-fetch tool types for all call_tool effects so priority can be resolved per tool type
    const toolIds = [...new Set(
      filteredEffects.filter(e => e.effect.type === 'call_tool').map(e => (e.effect as CallToolEffect).toolId)
    )];
    const toolTypeMap = await this.toolService.getToolTypesByIds(context.projectId, toolIds);

    // Sort all effects by priority (lower numbers execute first)
    let sortedEffects = filteredEffects.sort(
      (a, b) => this.getEffectPriority(a.effect, toolTypeMap) - this.getEffectPriority(b.effect, toolTypeMap)
    );

    // Resolve conflicts between effects
    sortedEffects = this.resolveEffectConflicts(sortedEffects);

    logger.debug({ conversationId: context.conversationId, effectOrder: sortedEffects.map(op => ({ type: op.effect.type, action: op.actionName })) }, `Executing effects in global priority order after conflict resolution`);

    // Emit execution plan event BEFORE any effects are executed
    const executionPlanEventData: ActionsExecutionPlanEventData = {
      stageId,
      actions: actions.map(a => this.getActionName(a)),
      effects: sortedEffects.map(({ effect, actionName }) => ({ actionName, effect })),
      lifecycleContext,
    };
    await emitEvent('execution_plan', executionPlanEventData);

    // Track results
    const outcome: ActionsExecutionOutcome = {
      success: true,
      shouldEndConversation: false,
      shouldAbortConversation: false,
      shouldGenerateResponse: false,
      hasModifiedVars: false,
      hasModifiedUserInput: false,
      hasModifiedUserProfile: false,
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
        const effectResult = await this.executeEffect(effect, currentContext, actionName, emitEvent);

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

        // Check if effect resulted in stage change
        if (effectResult.newStageId) {
          outcome.goToStageId = effectResult.newStageId;
          outcome.goToStageSourceAction = actionName;
        }

        // Propagate visibility override from change_visibility effect
        if (effectResult.turnVisibility) {
          outcome.turnVisibility = effectResult.turnVisibility;
        }

        // Check if effect resulted in conversation termination
        if (effectResult.shouldEndConversation) {
          outcome.shouldEndConversation = true;
          outcome.endReason = effectResult.endReason;
          outcome.endConversationSourceAction = actionName;
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
          outcome.abortConversationSourceAction = actionName;
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
   * @param context - Execution context
   * @param actionName - Name of the action that triggered this effect
   * @param emitEvent - Callback to emit conversation events inline
   * @returns Result indicating if conversation should end/abort and any modified user input
   */
  private async executeEffect(
    effect: Effect,
    context: ConversationContext,
    actionName: string,
    emitEvent: EffectEventCallback,
  ): Promise<EffectOutcome> {
    switch (effect.type) {
      case 'end_conversation':
        return await this.executeEndConversation(effect, context);

      case 'abort_conversation':
        return await this.executeAbortConversation(effect, context);

      case 'go_to_stage':
        return await this.executeGoToStage(effect, context);

      case 'modify_user_input':
        return await this.executeModifyUserInput(effect, context, actionName, emitEvent);

      case 'modify_variables': {
        const changedVariableNames = (effect as ModifyVariablesEffect).modifications.map((m) => m.variableName);
        const result = await this.modifyVariablesExecutor.execute(effect, context);
        await emitEvent('variables_updated', { sourceActionName: actionName, changedVariableNames, variables: context.vars as any });
        return result;
      }

      case 'modify_user_profile': {
        const changedProfileNames = (effect as ModifyUserProfileEffect).modifications.map((m) => m.fieldName);
        const result = await this.modifyUserProfileExecutor.execute(effect, context);
        await emitEvent('user_profile_updated', { sourceActionName: actionName, changedProfileNames, profile: context.userProfile as any });
        return result;
      }

      case 'call_tool':
        return await this.executeCallTool(effect, context, actionName, emitEvent);

      case 'generate_response':
        return await this.executeGenerateResponse(effect, context, actionName);

      case 'change_visibility':
        return await this.executeChangeVisibility(effect, actionName, emitEvent);

      case 'ban_user':
        return await this.executeBanUser(effect, context, actionName, emitEvent);

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
   * Executes modify_user_input effect
   * Renders a template using TemplatingEngine and replaces the user input with it
   */
  private async executeModifyUserInput(
    effect: ModifyUserInputEffect,
    context: ConversationContext,
    actionName: string,
    emitEvent: EffectEventCallback,
  ): Promise<EffectOutcome> {
    logger.info({ conversationId: context.conversationId, originalInput: context.userInput, template: effect.template }, `Modifying user input`);

    try {
      // Render the template using the templating engine with full context
      const modifiedInput = await this.templatingEngine.render(effect.template, context);

      logger.info({ conversationId: context.conversationId, originalInput: context.userInput, modifiedInput }, `User input modified`);
      context.userInput = modifiedInput;

      await emitEvent('user_input_modified', { sourceActionName: actionName, modifiedInput });

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
    actionName: string,
    emitEvent: EffectEventCallback,
  ): Promise<EffectOutcome> {
    logger.info({ toolId: effect.toolId, parameterCount: Object.keys(effect.parameters).length }, `Calling tool: ${effect.toolId}`);

    try {
      // 1. Load the tool
      const tool = await this.toolService.getToolById(context.projectId, effect.toolId);
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

      // 4. Store the result in context.results.tools
      if (!context.results) {
        context.results = { webhooks: {}, tools: {} };
      }
      if (!context.results.tools) {
        context.results.tools = {};
      }

      // Store result in the context bucket
      if (tool.type === 'webhook') { // for backwards compatibility, also store webhook tool results in context.results.webhooks
        if (!context.results.webhooks) context.results.webhooks = {};
        context.results.webhooks[tool.id] = executionResult.result;
      }

      context.results.tools[tool.id] = {
        toolId: tool.id,
        toolName: tool.name,
        toolType: tool.type,
        parameters: resolvedParameters,
        result: executionResult.result,
        executedAt: new Date().toISOString(),
      };


      logger.info({ conversationId: context.conversationId, toolId: effect.toolId, toolName: tool.name, toolType: tool.type }, `Tool called successfully and result stored: ${tool.name}`);

      // Emit tool_call event inline now that the effect has been applied
      await emitEvent('tool_call', {
        toolId: tool.id,
        toolName: tool.name,
        toolType: tool.type,
        parameters: resolvedParameters,
        success: executionResult.success,
        result: executionResult.result,
        error: executionResult.failureReason,
        sourceActionName: actionName,
        metadata: {
          systemPrompt: executionResult.renderedPrompt,
          llmUsage: executionResult.llmUsage,
          durationMs: executionResult.durationMs,
          startMs: executionResult.startMs,
          endMs: executionResult.endMs,
        },
      });

      // For script tools, propagate flow control and mutable-state change flags onto the outcome
      const flowControl = executionResult.flowControl ?? {};
      return {
        shouldEndConversation: flowControl.shouldEndConversation ?? false,
        endReason: flowControl.endReason,
        shouldAbortConversation: flowControl.shouldAbortConversation ?? false,
        abortReason: flowControl.abortReason,
        newStageId: flowControl.goToStageId,
        shouldGenerateResponse: flowControl.shouldGenerateResponse,
        prescriptedResponse: flowControl.prescriptedResponse,
        hasModifiedVars: executionResult.hasModifiedVars ?? false,
        hasModifiedUserInput: executionResult.hasModifiedUserInput ?? false,
        hasModifiedUserProfile: executionResult.hasModifiedUserProfile ?? false,
      };
    } catch (error) {
      logger.error({ conversationId: context.conversationId, toolId: effect.toolId, error: error instanceof Error ? error.message : String(error) }, `Failed to call tool`);
      throw error;
    }
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

  /**
   * Executes change_visibility effect.
   * Produces a visibility override that the caller (ConversationRunner) applies to current-turn message events before saving.
   */
  private async executeChangeVisibility(effect: ChangeVisibilityEffect, actionName: string, emitEvent: EffectEventCallback): Promise<EffectOutcome> {
    const visibility: MessageVisibility = { visibility: effect.visibility, condition: effect.condition };
    logger.info({ visibility }, `Setting turn visibility override: ${effect.visibility}`);
    await emitEvent('visibility_changed', { sourceActionName: actionName, visibility });
    return {
      shouldEndConversation: false,
      shouldAbortConversation: false,
      turnVisibility: visibility,
    };
  }

  /**
   * Executes ban_user effect.
   * Bans the user associated with the current conversation.
   */
  private async executeBanUser(
    effect: BanUserEffect,
    context: ConversationContext,
    actionName: string,
    emitEvent: EffectEventCallback,
  ): Promise<EffectOutcome> {
    logger.info({ conversationId: context.conversationId, userId: context.userId, reason: effect.reason }, `Banning user`);
    await this.userService.banUser(context.projectId, context.userId, effect.reason);
    logger.info({ conversationId: context.conversationId, userId: context.userId }, `User banned successfully`);
    await emitEvent('user_banned', { sourceActionName: actionName, reason: effect.reason });
    return {
      shouldEndConversation: false,
      shouldAbortConversation: false,
    };
  }
}
