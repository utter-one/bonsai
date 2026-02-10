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
 * - 16MB memory limit per isolate
 * - 5-second timeout for script execution
 * - Isolated environment with no access to Node.js APIs or filesystem
 * - No access to require/import or network capabilities
 * - Proper cleanup to prevent memory leaks
 * 
 * Available APIs in scripts:
 * - `conversationId` - ID of the current conversation
 * - `stageId` - ID of the current stage in the conversation
 * - `history` - Array of conversation messages with role and content
 * - `actions` - Available actions in the current context
 * - `originalUserInput` - The original unmodified user input
 * - `results` - Results from previous operations
 * - `vars` - Mutable object containing all stage variables (can be modified)
 * - `userProfile` - Mutable object containing user profile data (can be modified)
 * - `userInput` - The current user input (can be modified)
 * - `console.log()`, `console.error()`, `console.warn()` - Logging functions
 */
@injectable()
export class IsolatedScriptExecutor {
  /**
   * Executes JavaScript code in an isolated VM with access to full conversation context.
   * 
   * @param code - The JavaScript code to execute
   * @param context - Execution context containing conversation and stage information
   * @throws Error if script execution fails or times out
   */
  async executeScript(code: string, context: ConversationContext): Promise<void> {
    logger.info({ conversationId: context.conversationId, stageId: context.stage.id, codeLength: code.length }, `Running script in isolated VM`);

    // Create isolated VM instance with memory limit (16MB)
    const isolate = new ivm.Isolate({ memoryLimit: 16 });

    try {
      // Create a new context within the isolate
      const ivmContext = await isolate.createContext();

      // Get a Reference to the global object within the context
      const jail = ivmContext.global;

      // Make the global object available in the context as `global`
      // We use derefInto() so that `global` is not a Reference{} in the isolate
      await jail.set('global', jail.derefInto());

      // Inject console methods using Callback
      // These run synchronously and log to the main isolate
      await jail.set('_consoleLog', new ivm.Callback((...args: any[]) => {
        logger.info({ conversationId: context.conversationId, stageId: context.stage.id }, `[Script Console] ${args.join(' ')}`);
      }));

      await jail.set('_consoleError', new ivm.Callback((...args: any[]) => {
        logger.error({ conversationId: context.conversationId, stageId: context.stage.id }, `[Script Console] ${args.join(' ')}`);
      }));

      await jail.set('_consoleWarn', new ivm.Callback((...args: any[]) => {
        logger.warn({ conversationId: context.conversationId, stageId: context.stage.id }, `[Script Console] ${args.join(' ')}`);
      }));

      // Set up console object in the isolate
      await ivmContext.eval('globalThis.console = { log: _consoleLog, error: _consoleError, warn: _consoleWarn };');

      // Inject read-only context fields using ExternalCopy
      // copyInto() automatically internalizes the value into the isolate
      await jail.set('conversationId', new ivm.ExternalCopy(context.conversationId).copyInto());
      await jail.set('stageId', new ivm.ExternalCopy(context.stage.id).copyInto());
      await jail.set('history', new ivm.ExternalCopy(context.history).copyInto());
      await jail.set('actions', new ivm.ExternalCopy(context.actions).copyInto());
      await jail.set('originalUserInput', new ivm.ExternalCopy(context.originalUserInput || null).copyInto());
      await jail.set('results', new ivm.ExternalCopy(context.results).copyInto());

      // Inject mutable objects that scripts can modify
      await jail.set('vars', new ivm.ExternalCopy(context.vars).copyInto());
      await jail.set('userProfile', new ivm.ExternalCopy(context.userProfile).copyInto());
      await jail.set('userInput', new ivm.ExternalCopy(context.userInput || null).copyInto());

      // Compile the script
      const script = await isolate.compileScript(code);

      // Run the script with a 5-second timeout
      await script.run(ivmContext, { timeout: 5000 });

      // Extract modified values back from the isolate
      // Get vars as a Reference, then copy it back
      const varsRef = await jail.get('vars', { reference: true });
      if (varsRef && varsRef.typeof === 'object') {
        const updatedVars = await varsRef.copy();
        // Update context with modified variables
        for (const [key, value] of Object.entries(updatedVars)) {
          context.vars[key] = value;
        }
        varsRef.release();
      }

      // Get userProfile as a Reference, then copy it back
      const userProfileRef = await jail.get('userProfile', { reference: true });
      if (userProfileRef && userProfileRef.typeof === 'object') {
        const updatedUserProfile = await userProfileRef.copy();
        // Update context with modified user profile
        for (const [key, value] of Object.entries(updatedUserProfile)) {
          context.userProfile[key] = value;
        }
        userProfileRef.release();
      }

      // Get userInput - it might be modified to a different value or null
      const userInputRef = await jail.get('userInput');
      if (userInputRef !== undefined) {
        // userInput can be a primitive or null, so we can copy it directly
        if (typeof userInputRef === 'string' || userInputRef === null) {
          context.userInput = userInputRef;
        } else if (userInputRef && typeof userInputRef === 'object' && 'copy' in userInputRef) {
          // It's a Reference, copy it
          const updatedUserInput = await (userInputRef as ivm.Reference<any>).copy();
          context.userInput = updatedUserInput;
          (userInputRef as ivm.Reference<any>).release();
        }
      }

      logger.info({ conversationId: context.conversationId, stageId: context.stage.id }, `Script executed successfully in isolated VM`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ conversationId: context.conversationId, stageId: context.stage.id, error: errorMessage }, `Failed to execute script in isolated VM`);
      // Swallow errors to prevent crashing the conversation runner
      // Scripts should not be able to crash the system
    } finally {
      // Dispose the isolate to free resources
      // This invalidates all references obtained from it
      isolate.dispose();
    }
  }
}
