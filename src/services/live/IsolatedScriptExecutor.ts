import { injectable } from 'tsyringe';
import ivm from 'isolated-vm';
import { logger } from '../../utils/logger';
import type { ConversationRunner } from './ConversationRunner';
import { ConversationContext } from './ConversationContextBuilder';

/**
 * Service responsible for executing JavaScript code in isolated VM environments
 * Provides secure script execution with memory limits, timeouts, and sandboxed APIs
 * 
 * Security features:
 * - 16MB memory limit per script execution
 * - 5-second timeout for script execution
 * - Isolated environment with no access to Node.js APIs or filesystem
 * - No access to require/import or network capabilities
 * 
 * Available APIs in scripts:
 * - `conversationId` - ID of the current conversation
 * - `projectId` - ID of the project the conversation belongs to
 * - `stageId` - ID of the current stage in the conversation
 * - `history` - Array of conversation messages with role and content
 * - `command` - Current command being executed, if any
 * - `variables` - Read-only object containing all stage variables
 * - `setVariable(name, value)` - Sets a stage variable
 * - `getVariable(name)` - Gets a stage variable (includes pending updates)
 * - `console.log()`, `console.error()`, `console.warn()` - Logging functions
 */
@injectable()
export class IsolatedScriptExecutor {
  /**
   * Executes JavaScript code in an isolated VM with access to full conversation context.
   * 
   * @param code - The JavaScript code to execute
   * @param runner - The conversation runner instance for variable access
   * @param context - Execution context containing conversation and stage information
   * @throws Error if script execution fails or times out
   */
  async executeScript(
    code: string,
    runner: ConversationRunner,
    context: ConversationContext,
  ): Promise<void> {
    logger.info({ conversationId: context.conversationId, stageId: context.stageId, codeLength: code.length }, `Running script in isolated VM`);

    // Create isolated VM instance with memory limit (16MB) and timeout protection
    const isolate = new ivm.Isolate({ memoryLimit: 16 });
    
    try {
      // Create a new context within the isolate
      const ivmContext = await isolate.createContext();

      // Inject context as global object
      const jail = ivmContext.global;
      await jail.set('global', jail.derefInto());

      // Track variable updates
      const variableUpdates: Record<string, any> = {};

      // Inject context fields into the VM
      await jail.set('conversationId', new ivm.ExternalCopy(context.conversationId).copyInto());
      await jail.set('projectId', new ivm.ExternalCopy(context.projectId).copyInto());
      await jail.set('stageId', new ivm.ExternalCopy(context.stageId).copyInto());
      await jail.set('history', new ivm.ExternalCopy(context.history).copyInto());
      await jail.set('command', new ivm.ExternalCopy(context.command).copyInto());
      await jail.set('vars', new ivm.ExternalCopy(context.vars).copyInto());

      // Inject console.log, console.error, console.warn
      await jail.set('console', new ivm.ExternalCopy({
        log: new ivm.Reference((...args: any[]) => {
          logger.info({ conversationId: context.conversationId, stageId: context.stageId, args }, `[Script Console] ${args.join(' ')}`);
        }),
        error: new ivm.Reference((...args: any[]) => {
          logger.error({ conversationId: context.conversationId, stageId: context.stageId, args }, `[Script Console] ${args.join(' ')}`);
        }),
        warn: new ivm.Reference((...args: any[]) => {
          logger.warn({ conversationId: context.conversationId, stageId: context.stageId, args }, `[Script Console] ${args.join(' ')}`);
        }),
      }).copyInto());

      // Compile and run the user's script with a 5-second timeout
      const script = await isolate.compileScript(code);
      await script.run(ivmContext, { timeout: 5000 });
      
      logger.info({ conversationId: context.conversationId, stageId: context.stageId, variableUpdates: Object.keys(variableUpdates).length }, `Script executed successfully in isolated VM`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ conversationId: context.conversationId, stageId: context.stageId, error: errorMessage }, `Failed to execute script in isolated VM`);
      throw new Error(`Script execution failed: ${errorMessage}`);
    } finally {
      // Clean up the isolate
      isolate.dispose();
    }
  }
}
