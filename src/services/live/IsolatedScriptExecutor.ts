import { injectable } from 'tsyringe';
import ivm from 'isolated-vm';
import crypto from 'crypto';
import { logger } from '../../utils/logger';
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
 *
 * Read-only context:
 * - `conversationId` - ID of the current conversation
 * - `projectId` - ID of the current project
 * - `stageId` - ID of the current stage in the conversation
 * - `stage` - Full stage object: id, name, availableActions, metadata, enterBehavior, useKnowledge
 * - `history` - Array of conversation messages with role and content
 * - `actions` - Matched action results and their parameters
 * - `originalUserInput` - The original unmodified user input
 * - `results` - Results from tools and webhooks
 * - `time` - Rich time context: iso, date, time, dayOfWeek, timezone, calendar, anchor, etc.
 * - `userInputSource` - Input channel: 'text' | 'voice' | null
 * - `stageVars` - Variables for all stages keyed by stage id
 *
 * Mutable context (changes persist after script execution):
 * - `vars` - Current stage variables; supports full replacement including key deletion
 * - `userProfile` - End user profile data; supports full replacement including key deletion
 * - `userInput` - Current user input text (can be replaced or set to null)
 *
 * Utility functions:
 * - `btoa(str)` - Base64-encode a binary string
 * - `atob(b64)` - Decode a base64 string
 * - `uuid()` - Generate a random UUID v4
 * - `hash(algorithm, data)` - Compute a hex digest; algorithm must be 'sha256', 'sha512', or 'md5'
 * - `formatDate(iso, locale?, options?)` - Format an ISO date string via Intl.DateTimeFormat
 *
 * Logging:
 * - `console.log()`, `console.error()`, `console.warn()` - Captured to application logs
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
  async executeScript(code: string, context: ConversationContext): Promise<any> {
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
      await jail.set('projectId', new ivm.ExternalCopy(context.projectId).copyInto());
      await jail.set('stageId', new ivm.ExternalCopy(context.stage.id).copyInto());
      await jail.set('stage', new ivm.ExternalCopy(context.stage).copyInto());
      await jail.set('history', new ivm.ExternalCopy(context.history).copyInto());
      await jail.set('actions', new ivm.ExternalCopy(context.actions).copyInto());
      await jail.set('originalUserInput', new ivm.ExternalCopy(context.originalUserInput || null).copyInto());
      await jail.set('results', new ivm.ExternalCopy(context.results).copyInto());
      await jail.set('time', new ivm.ExternalCopy(context.time).copyInto());
      await jail.set('userInputSource', new ivm.ExternalCopy(context.userInputSource || null).copyInto());
      await jail.set('stageVars', new ivm.ExternalCopy(context.stageVars || null).copyInto());

      // Inject mutable objects that scripts can modify
      await jail.set('vars', new ivm.ExternalCopy(context.vars).copyInto());
      await jail.set('userProfile', new ivm.ExternalCopy(context.userProfile).copyInto());
      await jail.set('userInput', new ivm.ExternalCopy(context.userInput || null).copyInto());

      // Inject utility functions as synchronous host callbacks
      await jail.set('btoa', new ivm.Callback((str: string) => Buffer.from(str, 'binary').toString('base64')));
      await jail.set('atob', new ivm.Callback((b64: string) => Buffer.from(b64, 'base64').toString('binary')));
      await jail.set('uuid', new ivm.Callback(() => crypto.randomUUID()));
      await jail.set('hash', new ivm.Callback((algorithm: string, data: string) => {
        const allowed = ['sha256', 'sha512', 'md5'];
        if (!allowed.includes(algorithm)) throw new Error(`hash(): unsupported algorithm '${algorithm}'. Use: ${allowed.join(', ')}`);
        return crypto.createHash(algorithm).update(data).digest('hex');
      }));
      await jail.set('formatDate', new ivm.Callback((iso: string, locale?: string, options?: Record<string, string>) => {
        return new Intl.DateTimeFormat(locale ?? undefined, options ?? undefined).format(new Date(iso));
      }));

      // Compile the script
      const script = await isolate.compileScript(code);

      // Run the script with a 5-second timeout
      const result = await script.run(ivmContext, { timeout: 5000 });

      // Extract modified values back from the isolate using full replacement
      // so that key deletions (delete vars.foo) are reflected correctly
      const varsRef = await jail.get('vars', { reference: true });
      if (varsRef && varsRef.typeof === 'object') {
        context.vars = await varsRef.copy();
        varsRef.release();
      }

      const userProfileRef = await jail.get('userProfile', { reference: true });
      if (userProfileRef && userProfileRef.typeof === 'object') {
        context.userProfile = await userProfileRef.copy();
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
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ conversationId: context.conversationId, stageId: context.stage.id, error: errorMessage }, `Failed to execute script in isolated VM`);
      // Swallow errors to prevent crashing the conversation runner
      // Scripts should not be able to crash the system
      return undefined;
    } finally {
      // Dispose the isolate to free resources
      // This invalidates all references obtained from it
      isolate.dispose();
    }
  }
}
