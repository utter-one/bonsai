import { inject, singleton } from "tsyringe";
import { z } from "zod";
import { LlmProviderFactory } from "../providers/llm/LlmProviderFactory";
import { Tool } from "../../types/models";
import { db } from "../../db";
import { NotFoundError } from "../../errors";
import { llmContentSchema, LlmGenerationOptions, LlmMessage, MessageContent } from "../providers/llm/ILlmProvider";
import { buildLlmUsage, llmUsageMetadataSchema } from '../../utils/llmUsage';
import { TemplatingEngine } from "./TemplatingEngine";
import { ConversationContext, ConversationContextBuilder } from "./ConversationContextBuilder";
import logger from "../../utils/logger";
import { ImageParameterValue, ParameterValue, parameterValueSchema } from "../../types/parameters";
import { IsolatedScriptExecutor, ScriptFlowControl } from "./IsolatedScriptExecutor";

export const toolExecutionResultSchema = z.object({
  success: z.boolean(),
  failureReason: z.string().optional(),
  toolId: z.string(),
  parameters: z.record(z.string(), parameterValueSchema).describe('Parameters that were passed to the tool during execution'),
  result: z.unknown().optional().describe('Optional field for tool output'),
  renderedPrompt: z.string().optional(),
  /** Token usage from the LLM call, if available */
  llmUsage: llmUsageMetadataSchema.optional(),
  /** Total duration of the tool execution in milliseconds */
  durationMs: z.number().optional(),
  /** Unix timestamp (ms) when tool execution started */
  startMs: z.number().optional(),
  /** Unix timestamp (ms) when tool execution completed */
  endMs: z.number().optional(),
  /** Flow control signals emitted by script tools */
  flowControl: z.custom<ScriptFlowControl>().optional(),
  /** Whether the script tool modified stage variables */
  hasModifiedVars: z.boolean().optional(),
  /** Whether the script tool modified user input */
  hasModifiedUserInput: z.boolean().optional(),
  /** Whether the script tool modified user profile */
  hasModifiedUserProfile: z.boolean().optional(),
});

export type ToolExecutionResult = z.infer<typeof toolExecutionResultSchema>;

@singleton()
export class ToolExecutor {
  constructor(
    @inject(LlmProviderFactory) private readonly llmProviderFactory: LlmProviderFactory,
    @inject(TemplatingEngine) private readonly templatingEngine: TemplatingEngine,
    @inject(ConversationContextBuilder) private readonly conversationContextBuilder: ConversationContextBuilder,
    @inject(IsolatedScriptExecutor) private readonly scriptExecutor: IsolatedScriptExecutor,
  ) { }

  /**
   * Executes a tool by dispatching to the appropriate executor based on tool type.
   * @param tool The tool to execute.
   * @param context The conversation context used for templating and script execution.
   * @param parameters The resolved parameters to pass to the tool.
   * @returns A promise that resolves to the result of the tool execution.
   */
  async executeTool(tool: Tool, context: ConversationContext, parameters: Record<string, ParameterValue>): Promise<ToolExecutionResult> {
    if (tool.type === 'webhook') {
      return this.executeWebhookTool(tool, context, parameters);
    }
    if (tool.type === 'script') {
      return this.executeScriptTool(tool, context, parameters);
    }
    return this.executeSmartFunctionTool(tool, context, parameters);
  }

  /**
   * Executes a smart_function tool by invoking its LLM provider with the rendered prompt.
   * @throws NotFoundError if the associated LLM provider is not found.
   */
  private async executeSmartFunctionTool(tool: Tool, context: ConversationContext, parameters: Record<string, ParameterValue>): Promise<ToolExecutionResult> {
    if (!tool.llmProviderId) {
      throw new Error(`Tool "${tool.name}" does not have an associated LLM provider`);
    }
    const llmProviderEntity = await db.query.providers.findFirst({ where: (providers, { eq }) => eq(providers.id, tool.llmProviderId) });
    if (!llmProviderEntity) {
      throw new NotFoundError(`LLM provider with ID "${tool.llmProviderId}" not found for tool "${tool.name}"`);
    }

    const toolStartMs = Date.now();
    try {
      const llmProvider = this.llmProviderFactory.createProvider(llmProviderEntity, tool.llmSettings);
      const actualContext = { ...context, tool: { parameters } };
      await llmProvider.init();
      const renderedPrompt = await this.templatingEngine.render(tool.prompt, actualContext);
      logger.debug({ toolId: tool.id, renderedPrompt }, `Rendered prompt for tool "${tool.name}"`);

      const messages: LlmMessage[] = [{ role: 'system' as const, content: renderedPrompt }];
      const imageMessages = this.extractImageMessages(parameters);
      messages.push(...imageMessages);
      messages.push({ role: 'user' as const, content: 'Please complete the requested task based on the system instructions.' });

      const result = await llmProvider.generate(messages, { outputFormat: this.getOutputFormat(tool) });
      const endMs = Date.now();
      const durationMs = endMs - toolStartMs;
      return { success: true, toolId: tool.id, parameters, result: result.content, renderedPrompt, llmUsage: buildLlmUsage(result.usage, llmProviderEntity, tool.llmSettings?.model), durationMs, startMs: toolStartMs, endMs };
    } catch (error) {
      logger.error({ toolId: tool.id, error }, `Error executing tool "${tool.name}"`);
      const endMs = Date.now();
      return { success: false, toolId: tool.id, parameters, failureReason: error.message ?? 'Unknown error during tool execution', durationMs: endMs - toolStartMs, startMs: toolStartMs, endMs };
    }
  }

  /**
   * Executes a webhook tool by making an HTTP request with Handlebars-rendered URL, headers, and body.
   * The result is shaped as `{ status, statusText, headers, data }`.
   */
  private async executeWebhookTool(tool: Tool, context: ConversationContext, parameters: Record<string, ParameterValue>): Promise<ToolExecutionResult> {
    if (!tool.url) {
      throw new Error(`Webhook tool "${tool.name}" does not have a URL configured`);
    }

    const toolStartMs = Date.now();
    try {
      const templateContext = { ...context, tool: { parameters } };

      const renderedUrl = await this.templatingEngine.render(tool.url, templateContext);

      const renderedHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
      if (tool.webhookHeaders) {
        for (const [key, value] of Object.entries(tool.webhookHeaders)) {
          renderedHeaders[key] = await this.templatingEngine.render(value, templateContext);
        }
      }

      const method = tool.webhookMethod ?? 'GET';
      const fetchOptions: RequestInit = { method, headers: renderedHeaders };

      if (tool.webhookBody && ['POST', 'PUT', 'PATCH'].includes(method)) {
        fetchOptions.body = await this.templatingEngine.render(tool.webhookBody, templateContext);
      }

      logger.debug({ toolId: tool.id, url: renderedUrl, method }, `Executing webhook tool "${tool.name}"`);

      const response = await fetch(renderedUrl, fetchOptions);

      let data: unknown;
      const contentType = response.headers.get('content-type');
      if (contentType?.includes('application/json')) {
        data = await response.json();
      } else {
        data = await response.text();
      }

      const headersObj: Record<string, string> = {};
      response.headers.forEach((value, key) => { headersObj[key] = value; });

      const result = { status: response.status, statusText: response.statusText, headers: headersObj, data };
      const endMs = Date.now();
      const durationMs = endMs - toolStartMs;
      return { success: true, toolId: tool.id, parameters, result, durationMs, startMs: toolStartMs, endMs };
    } catch (error) {
      logger.error({ toolId: tool.id, url: tool.url, error }, `Error executing webhook tool "${tool.name}"`);
      const endMs = Date.now();
      return { success: false, toolId: tool.id, parameters, failureReason: error.message ?? 'Unknown error during webhook execution', durationMs: endMs - toolStartMs, startMs: toolStartMs, endMs };
    }
  }

  /**
   * Executes a script tool in an isolated VM with full flow-control capabilities.
   * Parameters are injected as `params` inside the script.
   */
  private async executeScriptTool(tool: Tool, context: ConversationContext, parameters: Record<string, ParameterValue>): Promise<ToolExecutionResult> {
    if (!tool.code) {
      throw new Error(`Script tool "${tool.name}" does not have code configured`);
    }

    const toolStartMs = Date.now();
    try {
      const scriptResult = await this.scriptExecutor.executeScript(tool.code, context, parameters);
      const endMs = Date.now();
      const durationMs = endMs - toolStartMs;
      return {
        success: true,
        toolId: tool.id,
        parameters,
        result: scriptResult.value,
        durationMs,
        startMs: toolStartMs,
        endMs,
        flowControl: scriptResult.flowControl,
        hasModifiedVars: scriptResult.hasModifiedVars,
        hasModifiedUserInput: scriptResult.hasModifiedUserInput,
        hasModifiedUserProfile: scriptResult.hasModifiedUserProfile,
      };
    } catch (error) {
      logger.error({ toolId: tool.id, error }, `Error executing script tool "${tool.name}"`);
      const endMs = Date.now();
      return { success: false, toolId: tool.id, parameters, failureReason: error.message ?? 'Unknown error during script execution', durationMs: endMs - toolStartMs, startMs: toolStartMs, endMs };
    }
  }

  private getOutputFormat(tool: Tool): LlmGenerationOptions['outputFormat'] {
    if (tool.outputType === 'text') return 'text';
    if (tool.outputType === 'image') return 'image';
    if (tool.outputType === 'multi-modal') return 'image';
    return 'text';
  }

  /**
   * Extracts image parameters from the parameters object and converts them to user messages with image content.
   * Supports both single image parameters and image array parameters.
   * @param parameters The parameters object containing potential image values
   * @returns Array of LlmMessage objects containing image content
   */
  private extractImageMessages(parameters: Record<string, ParameterValue>): LlmMessage[] {
    const imageMessages: LlmMessage[] = [];

    for (const [key, value] of Object.entries(parameters)) {
      if (this.isImageParameter(value)) {
        imageMessages.push({ role: 'user', content: [this.convertImageToContent(value)] });
      } else if (Array.isArray(value) && value.length > 0) {
        const arrayValue = value as any[];
        const allImages = arrayValue.every(v => this.isImageParameter(v));
        if (allImages) {
          imageMessages.push({ role: 'user', content: arrayValue.map(img => this.convertImageToContent(img as ImageParameterValue)) });
        }
      }
    }

    return imageMessages;
  }

  private isImageParameter(value: any): value is ImageParameterValue {
    return typeof value === 'object' && value !== null && typeof value.data === 'string' && typeof value.mimeType === 'string' && value.mimeType.startsWith('image/');
  }

  private convertImageToContent(image: ImageParameterValue): MessageContent {
    return { type: 'image', source: { type: 'base64', data: image.data, mimeType: image.mimeType } };
  }
}