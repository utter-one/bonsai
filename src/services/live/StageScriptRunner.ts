import { injectable } from 'tsyringe';
import ivm from 'isolated-vm';
import { logger } from '../../utils/logger';
import type { ConversationRunner } from './ConversationRunner';

/**
 * Context for script execution
 */
export type ScriptExecutionContext = {
  conversationId: string;
  stageId: string;
};

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
 * - `variables` - Read-only object containing all stage variables
 * - `setVariable(name, value)` - Sets a stage variable
 * - `getVariable(name)` - Gets a stage variable (includes pending updates)
 * - `console.log()`, `console.error()`, `console.warn()` - Logging functions
 */
@injectable()
export class StageScriptRunner {
  /**
   * Executes JavaScript code in an isolated VM with access to stage variables
   * 
   * @example
   * // Example script code:
   * // Get current counter value
   * const count = getVariable('counter') || 0;
   * 
   * // Increment and save
   * setVariable('counter', count + 1);
   * 
   * // Log the result
   * console.log('Counter updated to:', count + 1);
   * 
   * @param code - The JavaScript code to execute
   * @param runner - The conversation runner instance for variable access
   * @param context - Execution context containing conversation and stage information
   * @throws Error if script execution fails or times out
   */
  async executeScript(
    code: string,
    runner: ConversationRunner,
    context: ScriptExecutionContext,
  ): Promise<void> {
    logger.info({ conversationId: context.conversationId, stageId: context.stageId, codeLength: code.length }, `Running script in isolated VM`);

    // Create isolated VM instance with memory limit (16MB) and timeout protection
    const isolate = new ivm.Isolate({ memoryLimit: 16 });
    
    try {
      // Get all current variables
      const variables = await runner.getAllVariables(context.stageId);

      // Create a new context within the isolate
      const ivmContext = await isolate.createContext();

      // Create a jail for the context to access sandbox globals
      const jail = ivmContext.global;

      // Set up the variables object in the isolated context
      await jail.set('variables', new ivm.ExternalCopy(variables).copyInto());

      // Create storage for variable modifications
      const variableUpdates: Record<string, unknown> = {};

      // Create setVariable function that stores updates to apply later
      const setVariableCallback = new ivm.Reference(function(name: string, value: unknown) {
        variableUpdates[name] = value;
      });
      await jail.set('__setVariable', setVariableCallback);

      // Create getVariable function
      const getVariableCallback = new ivm.Reference(function(name: string) {
        if (name in variableUpdates) {
          return variableUpdates[name];
        }
        return variables[name];
      });
      await jail.set('__getVariable', getVariableCallback);

      // Create console logging functions that capture logs
      const logMessages: Array<{ level: string; args: unknown[] }> = [];
      
      const consoleLog = new ivm.Reference(function(...args: unknown[]) {
        logMessages.push({ level: 'info', args });
      });
      await jail.set('__consoleLog', consoleLog);

      const consoleError = new ivm.Reference(function(...args: unknown[]) {
        logMessages.push({ level: 'error', args });
      });
      await jail.set('__consoleError', consoleError);

      const consoleWarn = new ivm.Reference(function(...args: unknown[]) {
        logMessages.push({ level: 'warn', args });
      });
      await jail.set('__consoleWarn', consoleWarn);

      // Set up the sandbox API in the isolated context
      await ivmContext.eval(`
        globalThis.setVariable = function(name, value) {
          __setVariable.applySync(undefined, [name, value]);
        };
        
        globalThis.getVariable = function(name) {
          return __getVariable.applySync(undefined, [name]);
        };
        
        globalThis.console = {
          log: function(...args) {
            __consoleLog.applySync(undefined, args);
          },
          error: function(...args) {
            __consoleError.applySync(undefined, args);
          },
          warn: function(...args) {
            __consoleWarn.applySync(undefined, args);
          }
        };
      `);

      // Compile and run the user's script with a 5-second timeout
      const script = await isolate.compileScript(code);
      await script.run(ivmContext, { timeout: 5000 });
      
      // Apply all variable updates
      for (const [name, value] of Object.entries(variableUpdates)) {
        await runner.setVariable(context.stageId, name, value);
        logger.debug({ conversationId: context.conversationId, stageId: context.stageId, variableName: name }, `Variable updated from script: ${name}`);
      }

      // Log all captured console messages
      for (const log of logMessages) {
        const message = log.args.map(arg => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' ');
        switch (log.level) {
          case 'info':
            logger.info({ conversationId: context.conversationId, stageId: context.stageId, scriptLog: true }, message);
            break;
          case 'error':
            logger.error({ conversationId: context.conversationId, stageId: context.stageId, scriptLog: true }, message);
            break;
          case 'warn':
            logger.warn({ conversationId: context.conversationId, stageId: context.stageId, scriptLog: true }, message);
            break;
        }
      }

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
