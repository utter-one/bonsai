import { singleton } from "tsyringe";
import Handlebars from "handlebars";
import { ConversationContext } from "./ConversationContextBuilder";

/**
 * Templating engine for LLM prompts and other parts of the system.
 * Compiles templates with provided context to generate final text.
 */
@singleton()
export class TemplatingEngine {
  /**
   * Builds a prompt by compiling the Handlebars template with the provided context.
   * @param template - Handlebars template string
   * @param context - LlmContext object containing data for template compilation
   * @returns Compiled prompt string
   */
  async render(template: string, context: ConversationContext): Promise<string> {
    const compiledTemplate = Handlebars.compile(template);
    return compiledTemplate(context);
  }
}