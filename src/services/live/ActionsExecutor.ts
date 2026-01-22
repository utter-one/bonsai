import { injectable, inject } from 'tsyringe';
import { logger } from '../../utils/logger';
import { ConversationRunner } from './ConversationRunner';
import { IsolatedScriptExecutor } from './IsolatedScriptExecutor';
import { TemplatingEngine } from './TemplatingEngine';
import { ToolService } from '../ToolService';
import type { AbortConversationOperation, CallToolOperation, EndConversationOperation, GoToStageOperation, ModifyUserInputOperation, ModifyVariablesOperation, Operation, RunScriptOperation, StageAction } from '../../http/contracts/stage';
import type { GlobalAction } from '../../types/models';
import { ConversationContext, ConversationContextBuilder } from './ConversationContextBuilder';

/**
 * Execution result for an action
 */
export type ActionsExecutionOutcome = {
  success: boolean;
  shouldEndConversation: boolean;
  endReason?: string;
  shouldAbortConversation: boolean;
  abortReason?: string;
  hasModifiedVars: boolean;
  hasModifiedUserInput: boolean;
  error?: string;
};

/**
 * Outcome of an operation execution
 */
export type OperationOutcome = {
    shouldEndConversation: boolean;
    endReason?: string;
    shouldAbortConversation: boolean;
    abortReason?: string;
    modifiedUserInput?: string;
    modifiedVars?: Record<string, any>;
  };

/**
 * Operation with its source action for tracking
 */
type OperationWithSource = {
  operation: Operation;
  actionName: string;
  actionIndex: number;
};


/**
 * Service responsible for executing operations defined in stage actions and global actions
 * Handles all operation types: end_conversation, abort_conversation, go_to_stage, run_script, modify_user_input, call_tool
 */
@injectable()
export class ActionsExecutor {
  constructor(
    @inject(IsolatedScriptExecutor) private readonly scriptRunner: IsolatedScriptExecutor,
    @inject(ToolService) private readonly toolService: ToolService,
    @inject(ConversationContextBuilder) private readonly contextBuilder: ConversationContextBuilder,
    @inject(TemplatingEngine) private readonly templatingEngine: TemplatingEngine,
  ) {}

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
   * Gets the execution priority for an operation type
   * Lower numbers execute first
   * @param operation - The operation to get priority for
   * @returns Priority number (1-6)
   */
  private getOperationPriority(operation: Operation): number {
    switch (operation.type) {
      case 'call_tool':
        return 1;
      case 'modify_variables':
        return 2;
      case 'modify_user_input':
        return 3;
      case 'run_script':
        return 4;
      case 'end_conversation':
        return 5;
      case 'abort_conversation':
        return 6;
      case 'go_to_stage':
        return 7;
      default:
        return 999; // Unknown operations execute last
    }
  }

  /**
   * Detects and resolves conflicts between operations
   * @param operations - Array of operations to check for conflicts
   * @returns Resolved operations with conflicts handled
   */
  private resolveOperationConflicts(operations: OperationWithSource[]): OperationWithSource[] {
    const resolvedOperations: OperationWithSource[] = [];
    const conflicts: string[] = [];

    // Group operations by type for conflict detection
    const goToStageOps = operations.filter(op => op.operation.type === 'go_to_stage');
    const endConversationOps = operations.filter(op => op.operation.type === 'end_conversation');
    const abortConversationOps = operations.filter(op => op.operation.type === 'abort_conversation');
    const modifyUserInputOps = operations.filter(op => op.operation.type === 'modify_user_input');

    // Conflict 1: Multiple go_to_stage operations with different stage IDs
    if (goToStageOps.length > 1) {
      const stageIds = goToStageOps.map(op => (op.operation as Extract<Operation, { type: 'go_to_stage' }>).stageId);
      const uniqueStageIds = new Set(stageIds);
      
      if (uniqueStageIds.size > 1) {
        // Multiple different stage IDs - keep only the first one
        const firstOp = goToStageOps[0];
        conflicts.push(`Multiple go_to_stage operations with different IDs detected (${Array.from(uniqueStageIds).join(', ')}). Using first: ${(firstOp.operation as Extract<Operation, { type: 'go_to_stage' }>).stageId} from action "${firstOp.actionName}"`);
        
        // Remove all but the first go_to_stage operation
        const otherOps = operations.filter(op => op.operation.type !== 'go_to_stage');
        resolvedOperations.push(...otherOps, firstOp);
      } else {
        // Same stage ID - keep only one instance
        conflicts.push(`Multiple go_to_stage operations with same ID detected. Using first occurrence from action "${goToStageOps[0].actionName}"`);
        const otherOps = operations.filter(op => op.operation.type !== 'go_to_stage');
        resolvedOperations.push(...otherOps, goToStageOps[0]);
      }
    } else {
      resolvedOperations.push(...operations);
    }

    // Conflict 2: Both abort_conversation and end_conversation present
    if (abortConversationOps.length > 0 && endConversationOps.length > 0) {
      // Abort takes precedence - remove all end_conversation operations
      const firstAbort = abortConversationOps[0];
      conflicts.push(`Both abort_conversation and end_conversation detected. Prioritizing abort_conversation from action "${firstAbort.actionName}" - conversation will abort immediately`);
      
      resolvedOperations.splice(0, resolvedOperations.length);
      resolvedOperations.push(...operations.filter(op => op.operation.type !== 'end_conversation'));
    }

    // Conflict 3: Multiple abort_conversation operations
    if (abortConversationOps.length > 1) {
      const firstAbort = abortConversationOps[0];
      conflicts.push(`Multiple abort_conversation operations detected. Using first from action "${firstAbort.actionName}"`);
      
      resolvedOperations.splice(0, resolvedOperations.length);
      const otherOps = operations.filter(op => op.operation.type !== 'abort_conversation');
      resolvedOperations.push(...otherOps, firstAbort);
    }

    // Conflict 4: Multiple end_conversation operations
    if (endConversationOps.length > 1 && abortConversationOps.length === 0) {
      const firstEnd = endConversationOps[0];
      conflicts.push(`Multiple end_conversation operations detected. Using first from action "${firstEnd.actionName}"`);
      
      if (resolvedOperations.length === 0) {
        resolvedOperations.push(...operations);
      }
      const otherOps = resolvedOperations.filter(op => op.operation.type !== 'end_conversation');
      resolvedOperations.splice(0, resolvedOperations.length);
      resolvedOperations.push(...otherOps, firstEnd);
    }

    // Conflict 5: Multiple modify_user_input operations - this is NOT a conflict, they chain
    if (modifyUserInputOps.length > 1) {
      logger.debug(`Multiple modify_user_input operations detected (${modifyUserInputOps.length}). These will chain - each modifying the result of the previous`);
    }

    // Log all conflicts detected
    if (conflicts.length > 0) {
      logger.warn({ conflicts }, `Resolved ${conflicts.length} operation conflict(s)`);
    }

    return resolvedOperations.length > 0 ? resolvedOperations : operations;
  }

  /**
   * Executes all operations for a list of actions
   * Gathers all operations from all actions, sorts by priority, resolves conflicts, and executes in order
   * @param actions - Array of actions to execute (can be stage actions or global actions)
   * @param runner - The conversation runner instance
   * @param context - Execution context
   * @returns Array of execution results for each action
   */
  async executeActions(
    actions: (StageAction | GlobalAction)[],
    runner: ConversationRunner,
    context: ConversationContext
  ): Promise<ActionsExecutionOutcome> {
    logger.info({ conversationId: context.conversationId, actionCount: actions.length }, `Executing ${actions.length} action(s)`);

    // Gather all operations from all actions with their source information
    const allOperations: OperationWithSource[] = [];
    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      const actionName = this.getActionName(action);
      
      for (const operation of action.operations) {
        allOperations.push({
          operation,
          actionName,
          actionIndex: i,
        });
      }
    }

    logger.info({ conversationId: context.conversationId, totalOperations: allOperations.length }, `Gathered ${allOperations.length} operation(s) from ${actions.length} action(s)`);

    // Sort all operations by priority (lower numbers execute first)
    let sortedOperations = allOperations.sort(
      (a, b) => this.getOperationPriority(a.operation) - this.getOperationPriority(b.operation)
    );

    // Resolve conflicts between operations
    sortedOperations = this.resolveOperationConflicts(sortedOperations);

    logger.debug({ conversationId: context.conversationId, operationOrder: sortedOperations.map(op => ({ type: op.operation.type, action: op.actionName })) }, `Executing operations in global priority order after conflict resolution`);

    // Track results per action
    const outcome: ActionsExecutionOutcome = {
      success: true,
      shouldEndConversation: false,
      shouldAbortConversation: false,
      hasModifiedVars: false,
      hasModifiedUserInput: false,
    };

    let currentContext = { ...context };
    let shouldStop = false;

    // Execute all operations in priority order
    for (const { operation, actionName, actionIndex } of sortedOperations) {
      if (shouldStop) {
        logger.debug({ conversationId: context.conversationId, operationType: operation.type, actionName }, `Skipping operation due to conversation termination`);
        continue;
      }

      logger.debug({ conversationId: context.conversationId, actionName, operationType: operation.type }, `Executing operation: ${operation.type} from action: ${actionName}`);

      try {
        const operationResult = await this.executeOperation(operation, runner, currentContext);

        // Update context with modified user input if applicable
        if (operationResult.modifiedUserInput) {
          currentContext.userInput = operationResult.modifiedUserInput;
          outcome.hasModifiedUserInput = true;
        }

        // Update modified variables in context if applicable
        if (operationResult.modifiedVars) {
          currentContext.vars = {
            ...currentContext.vars,
            ...operationResult.modifiedVars,
          };
          outcome.hasModifiedVars = true;
        }

        // Check if operation resulted in conversation termination
        if (operationResult.shouldEndConversation) {

          outcome.shouldEndConversation = true;
          outcome.endReason = operationResult.endReason;
          shouldStop = true;
          logger.info({ conversationId: context.conversationId, actionName, endReason: operationResult.endReason }, `Conversation will end gracefully - skipping remaining operations`);
        }

        if (operationResult.shouldAbortConversation) {
          outcome.shouldAbortConversation = true;
          outcome.abortReason = operationResult.abortReason;
          shouldStop = true;
          logger.info({ conversationId: context.conversationId, actionName, abortReason: operationResult.abortReason }, `Conversation will abort immediately - skipping remaining operations`);
        }
      } catch (error) {
        outcome.success = false;
        outcome.error = error instanceof Error ? error.message : String(error);
        logger.error({ conversationId: context.conversationId, actionName, operationType: operation.type, error: outcome.error }, `Failed to execute operation: ${operation.type}`);
        // Continue executing other operations even if one fails?
      }
    }

    logger.info({ conversationId: context.conversationId, executedOperations: sortedOperations.length, actionCount: actions.length }, `Completed execution of operations from ${actions.length} action(s)`);
    return outcome;
  }

  /**
   * Executes a single operation based on its type
   * @param operation - The operation to execute
   * @param runner - The conversation runner instance
   * @param context - Execution context
   * @returns Result indicating if conversation should end/abort and any modified user input
   */
  private async executeOperation(
    operation: Operation,
    runner: ConversationRunner,
    context: ConversationContext,
  ): Promise<OperationOutcome> {
    switch (operation.type) {
      case 'end_conversation':
        return await this.executeEndConversation(operation, runner, context);

      case 'abort_conversation':
        return await this.executeAbortConversation(operation, runner, context);

      case 'go_to_stage':
        return await this.executeGoToStage(operation, runner, context);

      case 'run_script':
        return await this.executeRunScript(operation, runner, context);

      case 'modify_user_input':
        return await this.executeModifyUserInput(operation, runner, context);

      case 'modify_variables':
        return await this.executeModifyVariables(operation, runner, context);

      case 'call_tool':
        return await this.executeCallTool(operation, runner, context);

      default:
        // TypeScript should ensure this is unreachable
        const exhaustiveCheck: never = operation;
        throw new Error(`Unknown operation type: ${(exhaustiveCheck as any).type}`);
    }
  }

  /**
   * Executes end_conversation operation
   */
  private async executeEndConversation(
    operation: EndConversationOperation,
    runner: ConversationRunner,
    context: ConversationContext,
  ): Promise<{ shouldEndConversation: true; shouldAbortConversation: false; endReason?: string }> {
    logger.info({ conversationId: context.conversationId, reason: operation.reason }, `Ending conversation gracefully`);
    return {
      shouldEndConversation: true,
      shouldAbortConversation: false,
      endReason: operation.reason,
    };
  }

  /**
   * Executes abort_conversation operation
   */
  private async executeAbortConversation(
    operation: AbortConversationOperation,
    runner: ConversationRunner,
    context: ConversationContext,
  ): Promise<{ shouldEndConversation: false; shouldAbortConversation: true; abortReason?: string }> {
    logger.info({ conversationId: context.conversationId, reason: operation.reason }, `Aborting conversation immediately`);
    return {
      shouldEndConversation: false,
      shouldAbortConversation: true,
      abortReason: operation.reason,
    };
  }

  /**
   * Executes go_to_stage operation
   */
  private async executeGoToStage(
    operation: GoToStageOperation,
    runner: ConversationRunner,
    context: ConversationContext,
  ): Promise<{ shouldEndConversation: false; shouldAbortConversation: false }> {
    logger.info({ conversationId: context.conversationId, targetStageId: operation.stageId, currentStageId: context.stageId }, `Navigating to stage: ${operation.stageId}`);

    await runner.goToStage(operation.stageId);

    // Update context with new stage ID
    context.stageId = operation.stageId;

    logger.info({ conversationId: context.conversationId, newStageId: operation.stageId }, `Successfully navigated to stage: ${operation.stageId}`);

    return {
      shouldEndConversation: false,
      shouldAbortConversation: false,
    };
  }

  /**
   * Executes run_script operation
   * Delegates to StageScriptRunner for secure script execution in isolated VM
   */
  private async executeRunScript(
    operation: RunScriptOperation,
    runner: ConversationRunner,
    context: ConversationContext,
  ): Promise<{ shouldEndConversation: false; shouldAbortConversation: false }> {
    await this.scriptRunner.executeScript(operation.code, runner, context);

    return {
      shouldEndConversation: false,
      shouldAbortConversation: false,
    };
  }

  /**
   * Executes modify_user_input operation
   * Renders a template using TemplatingEngine and replaces the user input with it
   */
  private async executeModifyUserInput(
    operation: ModifyUserInputOperation,
    runner: ConversationRunner,
    context: ConversationContext,
  ): Promise<{ shouldEndConversation: false; shouldAbortConversation: false; modifiedUserInput: string }> {
    logger.info({ conversationId: context.conversationId, originalInput: context.userInput, template: operation.template }, `Modifying user input`);

    try {
      // Render the template using the templating engine with full context
      const modifiedInput = await this.templatingEngine.render(operation.template, context);

      logger.info({ conversationId: context.conversationId, originalInput: context.userInput, modifiedInput }, `User input modified`);

      return {
        shouldEndConversation: false,
        shouldAbortConversation: false,
        modifiedUserInput: modifiedInput,
      };
    } catch (error) {
      logger.error({ conversationId: context.conversationId, error: error instanceof Error ? error.message : String(error) }, `Failed to modify user input`);
      throw error;
    }
  }

  /**
   * Executes modify_variables operation
   * Updates stage variables using specific operations (set, reset, add, remove)
   */
  private async executeModifyVariables(
    operation: ModifyVariablesOperation,
    runner: ConversationRunner,
    context: ConversationContext,
  ): Promise<{ shouldEndConversation: false; shouldAbortConversation: false }> {
    logger.info({ conversationId: context.conversationId, stageId: context.stageId, modificationCount: operation.modifications.length }, `Modifying variables`);

    try {
      for (const modification of operation.modifications) {
        const { variableName, operation: op, value } = modification;

        switch (op) {
          case 'set': {
            await runner.setVariable(context.stageId, variableName, value);
            logger.debug({ conversationId: context.conversationId, variableName, value }, `Set variable: ${variableName}`);
            break;
          }

          case 'reset': {
            await runner.setVariable(context.stageId, variableName, undefined);
            logger.debug({ conversationId: context.conversationId, variableName }, `Reset variable: ${variableName}`);
            break;
          }

          case 'add': {
            const currentValue = await runner.getVariable(context.stageId, variableName);
            if (!Array.isArray(currentValue)) {
              logger.warn({ conversationId: context.conversationId, variableName, currentValue }, `Variable ${variableName} is not an array, initializing as array`);
              await runner.setVariable(context.stageId, variableName, [value]);
            } else {
              await runner.setVariable(context.stageId, variableName, [...currentValue, value]);
            }
            logger.debug({ conversationId: context.conversationId, variableName, value }, `Added to variable array: ${variableName}`);
            break;
          }

          case 'remove': {
            const currentValue = await runner.getVariable(context.stageId, variableName);
            if (!Array.isArray(currentValue)) {
              logger.warn({ conversationId: context.conversationId, variableName, currentValue }, `Variable ${variableName} is not an array, cannot remove value`);
            } else {
              const newValue = currentValue.filter(item => JSON.stringify(item) !== JSON.stringify(value));
              await runner.setVariable(context.stageId, variableName, newValue);
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

      logger.info({ conversationId: context.conversationId, stageId: context.stageId, modificationCount: operation.modifications.length }, `Variables modified successfully`);
    } catch (error) {
      logger.error({ conversationId: context.conversationId, stageId: context.stageId, error: error instanceof Error ? error.message : String(error) }, `Failed to modify variables`);
      throw error;
    }

    return {
      shouldEndConversation: false,
      shouldAbortConversation: false,
    };
  }

  /**
   * Executes call_tool operation
   * Calls a tool with the specified parameters and stores the result
   */
  private async executeCallTool(
    operation: CallToolOperation,
    runner: ConversationRunner,
    context: ConversationContext,
  ): Promise<{ shouldEndConversation: false; shouldAbortConversation: false }> {
    logger.info({ conversationId: context.conversationId, toolId: operation.toolId, parameterCount: Object.keys(operation.parameters).length }, `Calling tool: ${operation.toolId}`);

    try {
      // Load the tool
      const tool = await this.toolService.getToolById(operation.toolId);

      // TODO: Implement actual tool execution logic
      // This would involve:
      // 1. Validating input parameters against tool.inputType
      // 2. Executing the tool (likely calling an LLM with the tool's prompt)
      // 3. Storing the result in context or variables
      // 4. Validating output against tool.outputType

      logger.warn({ conversationId: context.conversationId, toolId: operation.toolId }, `Tool execution not yet fully implemented`);

      logger.info({ conversationId: context.conversationId, toolId: operation.toolId }, `Tool called successfully: ${tool.name}`);
    } catch (error) {
      logger.error({ conversationId: context.conversationId, toolId: operation.toolId, error: error instanceof Error ? error.message : String(error) }, `Failed to call tool`);
      throw error;
    }

    return {
      shouldEndConversation: false,
      shouldAbortConversation: false,
    };
  }
}
