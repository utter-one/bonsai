import { inject, singleton } from "tsyringe";
import { z } from "zod";
import { LlmProviderFactory } from "../providers/llm/LlmProviderFactory";
import { Tool } from "../../types/models";
import type { Effect } from "../../types/actions";
import { db } from "../../db";
import { NotFoundError, InvalidOperationError, RemoteConnectionError } from "../../errors";
import { llmContentSchema, LlmGenerationOptions, LlmMessage, MessageContent } from "../providers/llm/ILlmProvider";
import { buildLlmUsage, llmUsageMetadataSchema } from '../../utils/llmUsage';
import { TemplatingEngine } from "./TemplatingEngine";
import { ConversationContext, ConversationContextBuilder } from "./ConversationContextBuilder";
import logger from "../../utils/logger";
import { ImageParameterValue, ParameterValue, parameterValueSchema } from "../../types/parameters";
import { IsolatedScriptExecutor, ScriptFlowControl } from "./IsolatedScriptExecutor";
import type { CostManagementConfig } from '../../http/contracts/costManagement';
import { resolveProviderModelLimits, resolveOutputCap } from '../../utils/costManagement';
import { truncateMessagesToTokenBudget } from '../../utils/contextTruncation';
import { ToolReplyService } from '../ToolReplyService';

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
  /** Whether this tool execution is deferred (async reply pending) */
  isDeferred: z.boolean().optional(),
  /** Request ID for deferred tool replies */
  requestId: z.string().optional(),
  /** Flow-control effects from an instant webhook response */
  effects: z.custom<Effect[]>().optional(),
});

export type ToolExecutionResult = z.infer<typeof toolExecutionResultSchema>;

@singleton()
export class ToolExecutor {
  constructor(
    @inject(LlmProviderFactory) private readonly llmProviderFactory: LlmProviderFactory,
    @inject(TemplatingEngine) private readonly templatingEngine: TemplatingEngine,
    @inject(ConversationContextBuilder) private readonly conversationContextBuilder: ConversationContextBuilder,
    @inject(IsolatedScriptExecutor) private readonly scriptExecutor: IsolatedScriptExecutor,
    @inject(ToolReplyService) private readonly toolReplyService: ToolReplyService,
  ) { }

  /**
   * Executes a tool by dispatching to the appropriate executor based on tool type.
   * @param tool The tool to execute.
   * @param context The conversation context used for templating and script execution.
   * @param parameters The resolved parameters to pass to the tool.
   * @param conversationId Conversation ID for async reply tracking.
   * @param projectId Project ID for async reply tracking.
   * @returns A promise that resolves to the result of the tool execution.
   */
  async executeTool(
    tool: Tool,
    context: ConversationContext,
    parameters: Record<string, ParameterValue>,
    conversationId: string,
    projectId: string,
    costManagementConfig?: CostManagementConfig | null,
  ): Promise<ToolExecutionResult> {
    if (tool.type === 'webhook') {
      return this.executeWebhookTool(tool, context, parameters, conversationId, projectId);
    }
    if (tool.type === 'script') {
      return this.executeScriptTool(tool, context, parameters);
    }
    return this.executeSmartFunctionTool(tool, context, parameters, costManagementConfig);
  }

  /**
   * Executes a smart_function tool by invoking its LLM provider with the rendered prompt.
   * @throws NotFoundError if the associated LLM provider is not found.
   */
  private async executeSmartFunctionTool(tool: Tool, context: ConversationContext, parameters: Record<string, ParameterValue>, costManagementConfig?: CostManagementConfig | null): Promise<ToolExecutionResult> {
    if (!tool.llmProviderId) {
      throw new InvalidOperationError(`Tool "${tool.name}" does not have an associated LLM provider`);
    }
    const llmProviderEntity = await db.query.providers.findFirst({ where: (providers, { eq }) => eq(providers.id, tool.llmProviderId) });
    if (!llmProviderEntity) {
      throw new NotFoundError(`LLM provider with ID "${tool.llmProviderId}" not found for tool "${tool.name}"`);
    }

    const toolStartMs = Date.now();
    try {
      const llmProvider = await this.llmProviderFactory.createProvider(llmProviderEntity, tool.llmSettings);
      const actualContext = { ...context, tool: { parameters } };
      await llmProvider.init();
      const renderedPrompt = await this.templatingEngine.render(tool.prompt, actualContext);
      logger.debug({ toolId: tool.id }, `Rendered prompt for tool "${tool.name}"`);

      const messages: LlmMessage[] = [{ role: 'system' as const, content: renderedPrompt }];
      const imageMessages = this.extractImageMessages(parameters);
      messages.push(...imageMessages);
      messages.push({ role: 'user' as const, content: 'Please complete the requested task based on the system instructions.' });

      const toolModel = tool.llmSettings?.model;
      const toolLimits = resolveProviderModelLimits(costManagementConfig, llmProviderEntity.id, toolModel);
      const toolMaxTokens = resolveOutputCap(tool.llmSettings?.defaultMaxTokens, toolLimits, 'tool');
      const toolInputCap = toolLimits?.inputTokensLimits?.tool;
      const { messages: truncatedToolMessages, ...toolTruncation } = truncateMessagesToTokenBudget(messages, toolInputCap, toolModel);
      const toolOptions = { outputFormat: this.getOutputFormat(tool), ...(toolMaxTokens !== undefined ? { maxTokens: toolMaxTokens } : {}) };
      const result = await llmProvider.generate(truncatedToolMessages, toolOptions);
      const endMs = Date.now();
      const durationMs = endMs - toolStartMs;
      return { success: true, toolId: tool.id, parameters, result: result.content, renderedPrompt, llmUsage: buildLlmUsage(result.usage, llmProviderEntity, tool.llmSettings?.model, toolTruncation), durationMs, startMs: toolStartMs, endMs };
    } catch (error) {
      logger.error({ toolId: tool.id, error }, `Error executing tool "${tool.name}"`);
      const endMs = Date.now();
      return { success: false, toolId: tool.id, parameters, failureReason: error.message ?? 'Unknown error during tool execution', durationMs: endMs - toolStartMs, startMs: toolStartMs, endMs };
    }
  }

  /**
   * Executes a webhook tool by making an HTTP request with Handlebars-rendered URL, headers, and body.
   * The result is shaped as `{ status, statusText, headers, data }`.
   * Supports async reply mode: when tool.asyncReply is enabled, injects reply headers and handles 202 deferred responses.
   */
  private async executeWebhookTool(
    tool: Tool,
    context: ConversationContext,
    parameters: Record<string, ParameterValue>,
    conversationId: string,
    projectId: string,
  ): Promise<ToolExecutionResult> {
    if (!tool.url) {
      throw new InvalidOperationError(`Webhook tool "${tool.name}" does not have a URL configured`);
    }

    const toolStartMs = Date.now();
    try {
      const templateContext = { ...context, tool: { parameters } };

      const renderedUrl = await this.templatingEngine.render(tool.url, templateContext);

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(renderedUrl);
      } catch {
        throw new InvalidOperationError(`Webhook tool "${tool.name}" rendered to an invalid URL`);
      }
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        throw new InvalidOperationError(`Webhook tool "${tool.name}" URL scheme "${parsedUrl.protocol}" is not allowed. Only http and https are permitted.`);
      }

      const renderedHeaders: Record<string, string> = { 'Content-Type': 'application/json' };

      // Always generate and inject request ID
      const requestId = crypto.randomUUID();
      renderedHeaders['x-bonsai-request-id'] = requestId;

      // Inject async reply headers if enabled
      if (tool.asyncReply?.enabled) {
        renderedHeaders['x-bonsai-reply-url'] = `${process.env.APP_URL!.replace(/\/$/, '')}/api/reply`;
        if (tool.asyncReply.secret) {
          renderedHeaders['x-bonsai-reply-secret'] = tool.asyncReply.secret;
        }
      }

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

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      let response: Response;
      try {
        response = await fetch(renderedUrl, { ...fetchOptions, signal: controller.signal });
      } finally {
        clearTimeout(timeoutId);
      }

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

      // Extract effects from instant webhook response body (same format as deferred reply)
      const instantEffects: Effect[] = typeof data === 'object' && data !== null && Array.isArray((data as any).effects)
        ? (data as any).effects
        : undefined;

      // Strict response code handling based on tool configuration
      if (tool.asyncReply?.enabled) {
        // Deferred mode: expect 202 (deferred) or 200 (instant)
        if (response.status === 202) {
          if (typeof data === 'object' && data !== null && (data as any).deferred === true) {
            const timeoutMs = tool.asyncReply.timeoutMs || 300000;
            await this.toolReplyService.createPendingReply(projectId, conversationId, tool.id, requestId, timeoutMs);
            logger.info({ toolId: tool.id, requestId, conversationId }, `Webhook tool "${tool.name}" deferred reply`);
            return {
              success: true,
              toolId: tool.id,
              parameters,
              result,
              durationMs,
              startMs: toolStartMs,
              endMs,
              isDeferred: true,
              requestId,
            };
          }
          return { success: false, toolId: tool.id, parameters, failureReason: `HTTP 202 without deferred:true body — async reply expected but not acknowledged`, result, durationMs, startMs: toolStartMs, endMs, requestId };
        }
        if (response.status === 200) {
          logger.info({ toolId: tool.id, requestId, conversationId, hasEffects: !!instantEffects }, `Webhook tool "${tool.name}" responded instantly (200) while async reply was configured`);
          return { success: true, toolId: tool.id, parameters, result, durationMs, startMs: toolStartMs, endMs, requestId, effects: instantEffects };
        }
        return { success: false, toolId: tool.id, parameters, failureReason: `HTTP ${response.status}: ${response.statusText} — expected 200 (instant) or 202 (deferred)`, result, durationMs, startMs: toolStartMs, endMs, requestId };
      }

      // Non-deferred mode: only 200 is valid
      if (response.status === 200) {
        return { success: true, toolId: tool.id, parameters, result, durationMs, startMs: toolStartMs, endMs, requestId, effects: instantEffects };
      }
      return { success: false, toolId: tool.id, parameters, failureReason: `HTTP ${response.status}: ${response.statusText} — expected 200`, result, durationMs, startMs: toolStartMs, endMs, requestId };
    } catch (error) {
      const endMs = Date.now();
      const failureReason = error.message ?? 'Unknown error during webhook execution';
      logger.error({ toolId: tool.id, toolName: tool.name, url: tool.url, error }, `Error executing webhook tool "${tool.name}"`);
      return { success: false, toolId: tool.id, parameters, failureReason, durationMs: endMs - toolStartMs, startMs: toolStartMs, endMs };
    }
  }

  /**
   * Executes a script tool in an isolated VM with full flow-control capabilities.
   * Parameters are injected as `params` inside the script.
   */
  private async executeScriptTool(tool: Tool, context: ConversationContext, parameters: Record<string, ParameterValue>): Promise<ToolExecutionResult> {
    if (!tool.code) {
      throw new InvalidOperationError(`Script tool "${tool.name}" does not have code configured`);
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
        const allImages = value.every(v => this.isImageParameter(v));
        if (allImages) {
          imageMessages.push({ role: 'user', content: value.map(img => this.convertImageToContent(img)) });
        }
      }
    }

    return imageMessages;
  }

  private isImageParameter(value: ParameterValue): value is ImageParameterValue {
    return typeof value === 'object' && !Array.isArray(value) && value !== null && 'data' in value && 'mimeType' in value && typeof value.data === 'string' && typeof value.mimeType === 'string' && value.mimeType.startsWith('image/');
  }

  private convertImageToContent(image: ImageParameterValue): MessageContent {
    return { type: 'image', source: { type: 'base64', data: image.data, mimeType: image.mimeType } };
  }
}
