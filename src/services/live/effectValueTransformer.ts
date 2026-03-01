import type { IsolatedScriptExecutor } from './IsolatedScriptExecutor';
import type { TemplatingEngine } from './TemplatingEngine';
import type { ConversationContext } from './ConversationContextBuilder';

/**
 * Transforms a modification value for effect executors.
 * Resolves special reference patterns before falling back to Handlebars template rendering.
 *
 * Supported patterns (matched against the entire trimmed string):
 * - `{{results.tools.toolId.result}}` — resolved from tool execution results; if the result is
 *   an array the first element is returned
 * - `{{vars.variableName}}` — resolved from current stage variables
 * - `{{stageVars.stageName.variableName}}` — resolved from a named stage's variables
 * - `{{userProfile.fieldName}}` — resolved from user profile fields
 * - `= <expression>` — evaluated as an inline script via {@link IsolatedScriptExecutor}
 * - Any other string — rendered through the {@link TemplatingEngine}
 *
 * Non-string values are passed through unchanged.
 *
 * @param value - The raw value from the modification definition
 * @param context - The current conversation context
 * @param scriptRunner - Executor used to run inline `=` expressions
 * @param templatingEngine - Engine used to render Handlebars templates
 * @returns The resolved value
 */
export async function transformEffectValue(
  value: unknown,
  context: ConversationContext,
  scriptRunner: IsolatedScriptExecutor,
  templatingEngine: TemplatingEngine,
): Promise<unknown> {
  if (typeof value !== 'string') return value;

  // support for referencing tool results using {{results.tools.toolId.result}}
  const toolResultPattern = /^\{\{results\.tools\.([^.]+)\.result\}\}$/;
  // support for referencing variables using {{vars.variableName}}
  const varSimpleReferencePattern = /^\{\{vars\.([^.]+)\}\}$/;
  // support for referencing variables using {{stageVars.stageName.variableName}}
  const varStageReferencePattern = /^\{\{stageVars\.([^.]+)\.([^.]+)\}\}$/;
  // support for referencing user profile fields using {{userProfile.fieldName}}
  const userProfileReferencePattern = /^\{\{userProfile\.([^.]+)\}\}$/;

  const trimmed = value.trim();
  const toolResultMatch = trimmed.match(toolResultPattern);
  const varSimpleMatch = trimmed.match(varSimpleReferencePattern);
  const varStageMatch = trimmed.match(varStageReferencePattern);
  const userProfileMatch = trimmed.match(userProfileReferencePattern);

  if (toolResultMatch) {
    // Tool Result Reference
    const toolId = toolResultMatch[1];
    const result = context.results.tools[toolId]?.result;
    return Array.isArray(result) ? result[0] : result;
  }

  if (varSimpleMatch) {
    // Simple Variable Reference
    return context.vars[varSimpleMatch[1]];
  }

  if (varStageMatch) {
    // Stage Variable Reference
    const [, stageName, variableName] = varStageMatch;
    return context.stageVars[stageName]?.[variableName];
  }

  if (userProfileMatch) {
    // User Profile Reference
    return context.userProfile[userProfileMatch[1]];
  }

  if (value[0] === '=') {
    // Inline script expression
    const result = await scriptRunner.executeScript(value.slice(1).trim(), context);
    return result.value;
  }

  // Default: Handlebars template rendering
  return templatingEngine.render(value, context);
}
