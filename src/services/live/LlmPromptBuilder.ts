import { singleton } from "tsyringe";
import Handlebars from "handlebars";
import { LlmContext } from "./LlmContextBuilder";

/**
 * Builder for LLM prompts using Handlebars templating engine.
 * Compiles templates with provided context to generate final prompts for LLMs.
 */
@singleton()
export class LlmPromptBuilder {
  /**
   * Builds a prompt by compiling the Handlebars template with the provided context.
   * @param template - Handlebars template string
   * @param context - LlmContext object containing data for template compilation
   * @returns Compiled prompt string
   */
  async buildPrompt(template: string, context: LlmContext): Promise<string> {
    const compiledTemplate = Handlebars.compile(template);
    return compiledTemplate(context);
  }
}