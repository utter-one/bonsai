import { injectable } from 'tsyringe';
import ivm from 'isolated-vm';
import crypto from 'crypto';
import { logger } from '../../utils/logger';
import { ConversationContext } from './ConversationContextBuilder';

/**
 * Flow control signals emitted by a script via goToStage(), endConversation(), etc.
 * Only meaningful in run_script effect context; silently ignored in condition and expression evaluation.
 */
export type ScriptFlowControl = {
  /** Stage ID to transition to after the script finishes */
  goToStageId?: string;
  /** Whether the script requested conversation end */
  shouldEndConversation?: boolean;
  /** Reason for ending the conversation */
  endReason?: string;
  /** Whether the script requested conversation abort */
  shouldAbortConversation?: boolean;
  /** Reason for aborting the conversation */
  abortReason?: string;
  /**
   * Whether to generate a response after the script.
   * `true` with `prescriptedResponse` delivers that text directly; `true` without it triggers LLM generation.
   * `false` suppresses any response for this turn.
   */
  shouldGenerateResponse?: boolean;
  /** Pre-scripted response text to deliver, bypassing LLM generation */
  prescriptedResponse?: string;
};

/**
 * Result returned by executeScript(), carrying the script's return value,
 * flow control signals, and mutable-state change flags.
 */
export type ScriptExecutionResult = {
  /** Return value of the top-level script expression */
  value: any;
  /** Flow control signals emitted during execution */
  flowControl: ScriptFlowControl;
  /** True if context.vars was modified */
  hasModifiedVars: boolean;
  /** True if context.userInput was modified */
  hasModifiedUserInput: boolean;
  /** True if context.userProfile was modified */
  hasModifiedUserProfile: boolean;
};

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
 * - `uuid()` - Generate a random UUID v4
 * - `formatDate(iso, locale?, options?)` - Format an ISO date string via Intl.DateTimeFormat
 *
 * History utilities (pure JS, zero host round-trips):
 * - `lastMessage(role?)` - Content of the last message, optionally filtered by 'user' or 'assistant'
 * - `messageCount(role?)` - Total message count, optionally filtered by role
 * - `historyText(opts?)` - Messages formatted as "User: ...\nAssistant: ..."; opts: { n?, role?, labels? }
 * - `historyContains(substr, role?)` - Case-insensitive substring search across messages
 * - `stageMessages(role?)` - Messages exchanged in the current stage only, optionally filtered by role
 *
 * Flow control (run_script only; ignored in conditions and inline expressions):
 * - `goToStage(stageId)` - Transition to a different stage after the script
 * - `endConversation(reason?)` - End the conversation gracefully
 * - `abortConversation(reason?)` - Abort the conversation
 * - `prescriptResponse(text)` - Deliver a fixed response, bypassing LLM generation
 * - `suppressResponse()` - Suppress any response for this turn
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
   * @param toolParameters - Optional parameters injected as `params` when executing as a tool script
   * @throws Error if script execution fails or times out
   */
  async executeScript(code: string, context: ConversationContext, toolParameters?: Record<string, unknown>): Promise<ScriptExecutionResult> {
    logger.info({ conversationId: context.conversationId, stageId: context.stage.id, codeLength: code.length }, `Running script in isolated VM`);

    // Snapshot mutable state for change detection
    const varsSnapshot = JSON.stringify(context.vars);
    const userProfileSnapshot = JSON.stringify(context.userProfile);
    const userInputBefore = context.userInput;

    // Flow control signals collected via host callbacks
    const flowControl: ScriptFlowControl = {};

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
      await jail.set('events', new ivm.ExternalCopy(context.events).copyInto());
      await jail.set('consts', new ivm.ExternalCopy(context.consts || null).copyInto());

      // Inject mutable objects that scripts can modify
      await jail.set('vars', new ivm.ExternalCopy(context.vars).copyInto());
      await jail.set('userProfile', new ivm.ExternalCopy(context.userProfile).copyInto());
      await jail.set('userInput', new ivm.ExternalCopy(context.userInput || null).copyInto());

      // Utility functions
      await jail.set('uuid', new ivm.Callback(() => crypto.randomUUID()));
      await jail.set('formatDate', new ivm.Callback((iso: string, locale?: string, options?: Record<string, string>) => new Intl.DateTimeFormat(locale ?? undefined, options ?? undefined).format(new Date(iso))));

      // If called as a tool script, inject tool parameters as read-only `params`
      if (toolParameters !== undefined) {
        await jail.set('params', new ivm.ExternalCopy(toolParameters).copyInto());
      }

      // Flow control functions — signals are captured into flowControl and returned with ScriptExecutionResult
      await jail.set('goToStage', new ivm.Callback((stageId: string) => { flowControl.goToStageId = stageId; }));
      await jail.set('endConversation', new ivm.Callback((reason?: string) => { flowControl.shouldEndConversation = true; if (reason) flowControl.endReason = reason; }));
      await jail.set('abortConversation', new ivm.Callback((reason?: string) => { flowControl.shouldAbortConversation = true; if (reason) flowControl.abortReason = reason; }));
      await jail.set('prescriptResponse', new ivm.Callback((text: string) => { flowControl.shouldGenerateResponse = true; flowControl.prescriptedResponse = text; }));
      await jail.set('suppressResponse', new ivm.Callback(() => { flowControl.shouldGenerateResponse = false; }));

      // History utility functions (pure JS inside the isolate — no host round-trips)
      await ivmContext.eval(`
        function lastMessage(role) {
          var msgs = role ? history.filter(function(m) { return m.role === role; }) : history;
          return msgs.length ? msgs[msgs.length - 1].content : null;
        }
        function messageCount(role) {
          return role ? history.filter(function(m) { return m.role === role; }).length : history.length;
        }
        function historyText(opts) {
          var n = opts && opts.n != null ? opts.n : null;
          var role = opts && opts.role ? opts.role : null;
          var labels = (opts && opts.labels) ? opts.labels : {};
          var msgs = role ? history.filter(function(m) { return m.role === role; }) : history;
          if (n != null) msgs = msgs.slice(-n);
          var userLabel = labels.user || 'User';
          var assistantLabel = labels.assistant || 'Assistant';
          return msgs.map(function(m) { return (m.role === 'user' ? userLabel : assistantLabel) + ': ' + m.content; }).join('\\n');
        }
        function historyContains(substr, role) {
          var msgs = role ? history.filter(function(m) { return m.role === role; }) : history;
          var lower = substr.toLowerCase();
          return msgs.some(function(m) { return m.content.toLowerCase().indexOf(lower) !== -1; });
        }
        function stageMessages(role) {
          var jumps = events.filter(function(e) { return e.eventType === 'jump_to_stage'; });
          var offset = 0;
          if (jumps.length > 0) {
            var lastJumpTs = jumps[jumps.length - 1].timestamp;
            offset = events.filter(function(e) { return e.eventType === 'message' && e.timestamp <= lastJumpTs; }).length;
          }
          var msgs = history.slice(offset);
          return role ? msgs.filter(function(m) { return m.role === role; }) : msgs;
        }
      `);

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

      const hasModifiedVars = JSON.stringify(context.vars) !== varsSnapshot;
      const hasModifiedUserProfile = JSON.stringify(context.userProfile) !== userProfileSnapshot;
      const hasModifiedUserInput = context.userInput !== userInputBefore;

      logger.info({ conversationId: context.conversationId, stageId: context.stage.id }, `Script executed successfully in isolated VM`);
      return { value: result, flowControl, hasModifiedVars, hasModifiedUserInput, hasModifiedUserProfile };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ conversationId: context.conversationId, stageId: context.stage.id, error: errorMessage }, `Failed to execute script in isolated VM`);
      // Swallow errors to prevent crashing the conversation runner
      // Scripts should not be able to crash the system
      return { value: undefined, flowControl: {}, hasModifiedVars: false, hasModifiedUserInput: false, hasModifiedUserProfile: false };
    } finally {
      // Dispose the isolate to free resources
      // This invalidates all references obtained from it
      isolate.dispose();
    }
  }
}
