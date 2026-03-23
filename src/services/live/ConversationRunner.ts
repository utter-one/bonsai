import { z } from "zod";
import { inject, injectable } from "tsyringe";
import { NotFoundError } from "../../errors";
import { Classifier, ContextTransformer, Conversation, GlobalAction, Guardrail, Project, Stage, Tool } from "../../types/models";
import { StageAction, LIFECYCLE_ACTION_NAMES, CONVERSATION_LIFECYCLE_ACTION_IDS } from "../../types/actions";
import type { LifecycleContext } from "../../types/actions";
import { db } from "../../db";
import { conversations, users } from "../../db/schema";
import { MessageEventData, ActionEventData, CommandEventData, CommandType, ConversationStartEventData, ConversationResumeEventData, ConversationEndEventData, ConversationAbortedEventData, ConversationFailedEventData, JumpToStageEventData, ToolCallEventData, ModerationEventData, conversationStateSchema, ConversationState, MessageVisibility } from "../../types/conversationEvents";
import { ConversationService } from "../ConversationService";
import { logger } from "../../utils/logger";
import { AgentService } from "../AgentService";
import type { Session } from "../../channels/SessionManager";
import type { IClientConnection } from '../../channels/IClientConnection';
import type { CALUserTranscribedChunkMessage, CALAiTranscribedChunkMessage, CALStartAiGenerationOutputMessage, CALSendAiVoiceChunkMessage, CALEndAiGenerationOutputMessage, CALConversationEventMessage, CALConversationEventUpdateMessage } from '../../channels/messages';
import { ILlmProvider, LlmChunk, LlmGenerationResult } from "../providers/llm/ILlmProvider";
import { IAsrProvider } from "../providers/asr/IAsrProvider";
import { ITtsProvider } from "../providers/tts/ITtsProvider";
import { LlmProviderFactory } from "../providers/llm/LlmProviderFactory";
import { AsrProviderFactory } from "../providers/asr/AsrProviderFactory";
import { TtsProviderFactory } from "../providers/tts/TtsProviderFactory";
import { UserInputProcessor } from "./UserInputProcessor";
import { TtsSettings } from "../providers/tts/TtsProviderFactory";
import { ActionsExecutionOutcome, ActionsExecutor } from "./ActionsExecutor";
import { ConversationContext, ConversationContextBuilder } from "./ConversationContextBuilder";
import { and, eq, notInArray } from "drizzle-orm";
import { ResponseGenerator } from "./ResponseGenerator";
import { ToolExecutor } from "./ToolExecutor";
import { generateId, ID_PREFIXES } from "../../utils/idGenerator";

import { TemplatingEngine } from "./TemplatingEngine";
import { extractTextFromContent, getContentSize } from "../../utils/llm";
import { KnowledgeService } from "../KnowledgeService";
import { ModerationService } from "../ModerationService";
import type { FaqItem } from "./ConversationContextBuilder";
import type { AgentResponse } from "../../http/contracts/agent";
import type { IAudioConverter } from '../audio/IAudioConverter';
import type { AudioFormat } from '../../types/audio';
import { AudioConverterFactory } from '../audio/AudioConverterFactory';

/** Buffer holding the last converted audio chunk, used by the last-chunk-buffer pattern. */
type PendingOutboundChunk = { chunkId: string; ordinal: number; audio: Buffer };

export type ClassifierRuntimeData = {
  classifier: Classifier;
  llmProvider: ILlmProvider;
}

export type TransformerRuntimeData = {
  transformer: ContextTransformer;
  llmProvider: ILlmProvider;
}

/**
 * Holds all per-turn runtime state: correlation IDs, wall-clock timing markers,
 * and references needed to back-fill event metadata once async operations complete.
 * Reset at the start of every user-input turn via processUserInput.
 */
export type TurnData = {
  /** ID of the current input turn (assigned when user input is received) */
  inputTurnId?: string;
  /** ID of the current output turn (assigned when response generation begins) */
  outputTurnId?: string;
  /** Unix timestamp (ms) when the current turn started processing */
  startMs: number | null;
  /** Unix timestamp (ms) when LLM completion generation was started */
  llmStartMs: number | null;
  /** Unix timestamp (ms) when the first LLM completion token was received */
  firstTokenMs: number | null;
  /** Unix timestamp (ms) when the first audio chunk was delivered to the client (including filler) */
  firstAudioMs: number | null;
  /** Event ID of the saved assistant message event; used to back-fill totalTurnDurationMs after TTS completes */
  assistantMessageEventId: string | null;
  /** Duration of the filler sentence LLM call in milliseconds; null when no filler was generated */
  fillerDurationMs: number | null;
  /** Duration of the moderation API call in milliseconds; null when moderation was not performed */
  moderationDurationMs: number | null;
  /** Unix timestamp (ms) when ASR recognition started */
  asrStartMs: number | null;
  /** Unix timestamp (ms) when the TTS provider started synthesising the first chunk */
  ttsStartMs: number | null;
  /** Sequential 1-based turn number within the conversation */
  turnIndex: number;
};

export type StageRuntimeData = {
  id: string;
  conversation: Conversation;
  project: Project;
  stage: Stage;
  completionLlmProvider?: ILlmProvider;
  lastCompletionResult?: LlmGenerationResult;
  lastCompletionPrompt?: string;
  classifiers: ClassifierRuntimeData[];
  transformers: TransformerRuntimeData[];
  globalActions: GlobalAction[];
  guardrails: Guardrail[];
  guardrailClassifier?: ClassifierRuntimeData;
  asrProvider?: IAsrProvider;
  ttsProvider?: ITtsProvider;
  shouldEndConversation: boolean;
  agent: AgentResponse;
  fillerLlmProvider?: ILlmProvider;
  faq: FaqItem[];
}

/** 
 * Manages the lifecycle and state of a conversation. Runners are hosted by the SessionManager.
 */
@injectable()
export class ConversationRunner {
  private stageData: StageRuntimeData;
  private session: Session;
  private conversation: Conversation;
  private channel: IClientConnection;
  /** True when a filler sentence has already opened the response turn (outputTurnId assigned, start_ai_generation_output sent, TTS started) */
  private responseOutputTurnStarted: boolean = false;
  /** Filler sentence generated for the current turn, passed as assistant prefix to the LLM so it continues naturally */
  private lastFillerSentence: string | null = null;
  /** Rendered filler prompt used to generate the filler sentence for the current turn; stored for debugging */
  private lastFillerPrompt: string | null = null;
  /** Tracks the call depth of goToStage to distinguish top-level calls from recursive ones triggered by on_enter/on_leave actions */
  private navigationDepth = 0;
  /** Guards against multiple AI responses being generated within the same turn (e.g. when chained stage jumps each try to generate a response) */
  private responseGeneratedInTurn = false;
  /** Conversation-level lifecycle global actions keyed by reserved ID, loaded once in prepareConversation */
  private conversationLifecycleActions: Map<string, GlobalAction> = new Map();
  /** Visibility override for the current turn's messages, set by change_visibility effects */
  private turnMessageVisibility: MessageVisibility | undefined = undefined;

  /** Session-scoped inbound converter: client audio format → ASR input format. Null when no conversion is needed. */
  private inboundConverter: IAudioConverter | null = null;
  /** Session-scoped outbound converter: TTS native format → client preferred format. Null when no conversion is needed. */
  private outboundConverter: IAudioConverter | null = null;
  /** Sequential ordinal for outbound converted chunks; reset at the start of each TTS turn. */
  private outboundOrdinalCounter = 0;
  /** Last-chunk buffer for the outbound converter pathway; ensures isFinal is only applied to the terminal chunk. */
  private outboundPendingChunk: PendingOutboundChunk | null = null;

  /** Per-turn runtime data: correlation IDs, timing markers, and event tracking for the active input/output turn */
  private turnData: TurnData = { startMs: null, llmStartMs: null, firstTokenMs: null, firstAudioMs: null, assistantMessageEventId: null, fillerDurationMs: null, moderationDurationMs: null, asrStartMs: null, ttsStartMs: null, turnIndex: 0 };

  constructor(
    @inject(LlmProviderFactory) private llmProviderFactory: LlmProviderFactory,
    @inject(AsrProviderFactory) private asrProviderFactory: AsrProviderFactory,
    @inject(TtsProviderFactory) private ttsProviderFactory: TtsProviderFactory,
    @inject(ConversationService) private conversationService: ConversationService,
    @inject(ConversationContextBuilder) private contextBuilder: ConversationContextBuilder,
    @inject(AgentService) private agentService: AgentService,
    @inject(UserInputProcessor) private userInputProcessor: UserInputProcessor,
    @inject(ActionsExecutor) private actionsExecutor: ActionsExecutor,
    @inject(ResponseGenerator) private responseGenerator: ResponseGenerator,
    @inject(ToolExecutor) private toolExecutor: ToolExecutor,
    @inject(TemplatingEngine) private templatingEngine: TemplatingEngine,
    @inject(KnowledgeService) private knowledgeService: KnowledgeService,
    @inject(ModerationService) private moderationService: ModerationService,
  ) { }

  public getRuntimeData(): StageRuntimeData {
    return this.stageData;
  }

  async prepareConversation(conversationId: string, session: Session, channel: IClientConnection): Promise<void> {
    this.session = session;
    this.channel = channel;

    // Load conversation data
    this.conversation = await db.query.conversations.findFirst({
      where: (conversations, { and, eq }) => and(eq(conversations.projectId, session.projectId), eq(conversations.id, conversationId))
    });
    if (!this.conversation) {
      throw new NotFoundError(`Conversation with ID ${conversationId} not found`);
    }

    // Check if conversation is active
    if (this.conversation.status === 'finished' || this.conversation.status === 'failed' || this.conversation.status === 'aborted') {
      throw new Error(`Conversation with ID ${conversationId} is not active`);
    }

    this.stageData = await this.buildStageData(this.conversation);

    // Load conversation lifecycle global actions (by reserved ID) once — they are project-level and
    // must not appear in stage-level global action processing.
    const lifecycleActionsList = await db.query.globalActions.findMany({
      where: (globalActions, { and, eq, inArray }) => and(
        eq(globalActions.projectId, session.projectId),
        inArray(globalActions.id, Object.values(CONVERSATION_LIFECYCLE_ACTION_IDS))
      )
    });
    for (const action of lifecycleActionsList) {
      this.conversationLifecycleActions.set(action.id, action);
    }

    await this.wireUpProviders();
  }

  private async buildStageData(conversation: Conversation): Promise<StageRuntimeData> {
    // Load current stage data with agent relation
    const stage = await db.query.stages.findFirst({
      where: (stages, { and, eq }) => and(eq(stages.projectId, conversation.projectId), eq(stages.id, conversation.stageId)),
      with: { agent: true }
    });
    if (!stage) {
      throw new NotFoundError(`Stage with ID ${conversation.stageId} not found`);
    }

    const project = await db.query.projects.findFirst({ where: (projects, { eq }) => eq(projects.id, stage.projectId) });

    const stageData: StageRuntimeData = {
      id: stage.id,
      stage: stage,
      project: project,
      conversation: conversation,
      completionLlmProvider: undefined,
      lastCompletionResult: null,
      classifiers: [],
      transformers: [],
      globalActions: [],
      guardrails: [],
      guardrailClassifier: undefined,
      asrProvider: undefined,
      ttsProvider: undefined,
      shouldEndConversation: false,
      agent: null as any, // populated below after agentService.getAgentById
      faq: [],
    };

    // Load completion LLM provider for the stage
    if (stage.llmProviderId) {
      const llmProviderEntity = await db.query.providers.findFirst({ where: (providers, { eq }) => eq(providers.id, stage.llmProviderId) });
      if (llmProviderEntity) {
        stageData.completionLlmProvider = this.llmProviderFactory.createProvider(llmProviderEntity, stage.llmSettings);
      }
    }

    // Build classifier list dynamically:
    // 1. Collect all unique classifier IDs from defaultClassifierId and action overrides
    const classifierIds = new Set<string>();
    if (stage.defaultClassifierId) {
      classifierIds.add(stage.defaultClassifierId);
    }

    // Collect classifierIds from action overrides
    for (const [actionKey, action] of Object.entries(stage.actions)) {
      if (action.overrideClassifierId) {
        classifierIds.add(action.overrideClassifierId);
      }
    }

    // Also check global actions for classifier overrides
    if (stage.useGlobalActions) {
      for (const globalAction of stageData.globalActions) {
        if (globalAction.overrideClassifierId) {
          classifierIds.add(globalAction.overrideClassifierId);
        }
      }
    }

    // 2. Load all unique classifiers
    for (const classifierId of classifierIds) {
      const classifier = await db.query.classifiers.findFirst({
        where: (classifiers, { and, eq }) => and(eq(classifiers.projectId, conversation.projectId), eq(classifiers.id, classifierId))
      });
      if (!classifier) {
        throw new NotFoundError(`Classifier with ID ${classifierId} not found`);
      }
      const llmProviderEntity = await db.query.providers.findFirst({ where: (providers, { eq }) => eq(providers.id, classifier.llmProviderId) });
      const llmProvider = this.llmProviderFactory.createProvider(llmProviderEntity, classifier.llmSettings);
      stageData.classifiers.push({ classifier, llmProvider });
    }

    // Load transformers for the stage
    for (const transformerId of stage.transformerIds) {
      const transformer = await db.query.contextTransformers.findFirst({
        where: (contextTransformers, { and, eq }) => and(eq(contextTransformers.projectId, conversation.projectId), eq(contextTransformers.id, transformerId))
      });
      if (!transformer) {
        throw new NotFoundError(`Transformer with ID ${transformerId} not found`);
      }
      const llmProviderEntity = await db.query.providers.findFirst({ where: (providers, { eq }) => eq(providers.id, transformer.llmProviderId) });
      const llmProvider = this.llmProviderFactory.createProvider(llmProviderEntity, transformer.llmSettings);
      stageData.transformers.push({ transformer, llmProvider });
    }

    // Load global actions for the stage.
    // Meta actions (name starts with '__') are always loaded regardless of useGlobalActions.
    // Conversation lifecycle actions (__conversation_*) are excluded — they are loaded separately
    // in prepareConversation and must not participate in stage-level classification/triggering.
    // When useGlobalActions is enabled, the stage's configured actions are loaded on top.
    {
      const conversationLifecycleIds = Object.values(CONVERSATION_LIFECYCLE_ACTION_IDS);
      if (stage.useGlobalActions) {
        if (stage.globalActions.length === 0) {
          // All global actions for the project (includes meta actions), except conversation lifecycle actions
          const allGlobalActions = await db.query.globalActions.findMany({
            where: (globalActions, { eq }) => and(
              eq(globalActions.projectId, project.id),
              notInArray(globalActions.id, conversationLifecycleIds)
            )
          });
          stageData.globalActions = allGlobalActions;
        } else {
          // Selected actions + always include meta actions, excluding conversation lifecycle actions
          const selectedGlobalActions = await db.query.globalActions.findMany({
            where: (globalActions, { and, eq, or, inArray, like }) => and(
              eq(globalActions.projectId, project.id),
              notInArray(globalActions.id, conversationLifecycleIds),
              or(
                inArray(globalActions.id, stage.globalActions),
                like(globalActions.name, '__%')
              )
            )
          });
          stageData.globalActions = selectedGlobalActions;
        }
      } else {
        // Global actions disabled — load only meta actions, excluding conversation lifecycle actions
        const metaActions = await db.query.globalActions.findMany({
          where: (globalActions, { and, eq, like }) => and(
            eq(globalActions.projectId, project.id),
            notInArray(globalActions.id, conversationLifecycleIds),
            like(globalActions.name, '__%')
          )
        });
        stageData.globalActions = metaActions;
      }
    }

    // Load all project guardrails — they fire on every stage regardless of stage configuration
    {
      stageData.guardrails = await db.query.guardrails.findMany({
        where: (guardrails, { eq }) => eq(guardrails.projectId, project.id),
      });
    }

    // Load guardrail classifier if configured on the project
    if (project.defaultGuardrailClassifierId) {
      const guardrailClassifierEntity = await db.query.classifiers.findFirst({
        where: (classifiers, { and, eq }) => and(eq(classifiers.projectId, conversation.projectId), eq(classifiers.id, project.defaultGuardrailClassifierId)),
      });
      if (guardrailClassifierEntity) {
        const guardrailLlmProviderEntity = await db.query.providers.findFirst({ where: (providers, { eq }) => eq(providers.id, guardrailClassifierEntity.llmProviderId) });
        stageData.guardrailClassifier = {
          classifier: guardrailClassifierEntity,
          llmProvider: this.llmProviderFactory.createProvider(guardrailLlmProviderEntity, guardrailClassifierEntity.llmSettings),
        };
      } else {
        logger.warn({ projectId: project.id, classifierId: project.defaultGuardrailClassifierId }, 'Guardrail classifier not found, guardrails will be skipped');
      }
    }

    // Initialize TTS provider if configured and client wants voice output
    const agent = await this.agentService.getAgentById(stageData.project.id, stageData.stage.agentId);
    if (!agent) {
      throw new NotFoundError(`Agent with ID ${stageData.stage.agentId} not found`);
    }
    stageData.agent = agent;

    // Preload LLM provider for filler sentence generation if configured
    if (agent.fillerSettings?.llmProviderId) {
      const fillerLlmProviderEntity = await db.query.providers.findFirst({ where: (providers, { eq }) => eq(providers.id, agent.fillerSettings.llmProviderId) });
      if (fillerLlmProviderEntity) {
        stageData.fillerLlmProvider = this.llmProviderFactory.createProvider(fillerLlmProviderEntity, agent.fillerSettings.llmSettings);
      } else {
        logger.warn({ agentId: agent.id, llmProviderId: agent.fillerSettings.llmProviderId }, 'Filler LLM provider not found, filler responses will be skipped');
      }
    }

    const ttsSettings = agent.ttsSettings;
    if (project.generateVoice && agent.ttsProviderId && this.session.sessionSettings.receiveVoiceOutput) {
      const voiceProviderEntity = await db.query.providers.findFirst({ where: (providers, { eq }) => eq(providers.id, agent.ttsProviderId) });
      if (voiceProviderEntity && ttsSettings) {
        stageData.ttsProvider = this.ttsProviderFactory.createProvider(voiceProviderEntity, ttsSettings);
      }
    }

    // Initialize ASR provider if configured and client wants to send voice input
    if (project.acceptVoice && project.asrConfig?.asrProviderId && project.asrConfig.settings && this.session.sessionSettings.sendVoiceInput) {
      const asrProviderEntity = await db.query.providers.findFirst({ where: (providers, { eq }) => eq(providers.id, project.asrConfig.asrProviderId) });
      if (asrProviderEntity) {
        stageData.asrProvider = this.asrProviderFactory.createProvider(asrProviderEntity, project.asrConfig.settings);
      } else {
        throw new NotFoundError(`ASR Provider with ID ${project.asrConfig.asrProviderId} not found`);
      }
    }

    return stageData;
  }

  private async wireUpProviders() {
    const conversationId = this.stageData.conversation.id;
    const { asrProvider, ttsProvider, completionLlmProvider } = this.stageData;

    // Initialize and wire up ASR provider
    if (asrProvider) {
      try {
        await asrProvider.init();

        let isRecognizing = false;
        let chunkOrdinal = 0;
        asrProvider.setOnRecognitionStarted(async () => {
          isRecognizing = true;
          chunkOrdinal = 0;
          this.turnData.asrStartMs = Date.now();
        });

        asrProvider.setOnRecognizing(async (chunkId, text) => {
          logger.debug({ conversationId, chunkId }, `ASR recognizing chunk for conversation ${conversationId}: "${text}"`);

          const message: CALUserTranscribedChunkMessage = {
            type: 'user_transcribed_chunk',
            conversationId,
            chunkId,
            chunkText: text,
            ordinal: chunkOrdinal++,
            inputTurnId: this.turnData.inputTurnId,
            isFinal: false,
          };
          await this.channel.sendMessage(message);
        });

        asrProvider.setOnRecognized(async (chunkId, text) => {
          logger.debug({ conversationId, chunkId }, `ASR recognized chunk for conversation ${conversationId}`);

          const message: CALUserTranscribedChunkMessage = {
            type: 'user_transcribed_chunk',
            conversationId,
            chunkId,
            chunkText: text,
            ordinal: chunkOrdinal++,
            inputTurnId: this.turnData.inputTurnId,
            isFinal: true,
          };
          await this.channel.sendMessage(message);

          chunkOrdinal = 0;
        });

        asrProvider.setOnRecognitionStopped(async () => {
          const asrEndMs = Date.now();
          logger.info({ conversationId }, `ASR recognition stopped for conversation ${conversationId}`);

          isRecognizing = false;
          // Get all recognized text chunks and combine them
          const allTextChunks = asrProvider.getAllTextChunks();
          const fullText = allTextChunks.map(chunk => chunk.text).join(' ').trim();

          if (fullText) {
            logger.debug({ conversationId, chunkCount: allTextChunks.length }, `ASR complete text for conversation ${conversationId}`);
            const context = await this.contextBuilder.buildContextForUserInput(this.stageData.conversation, this.stageData.stage, [/** TODO */], fullText, fullText);
            context.userInputSource = 'voice';
            await this.processUserInput(fullText, 'voice', asrEndMs);
          } else {
            logger.warn({ conversationId }, `No text recognized for conversation ${conversationId}`);
            await this.processUserInput(this.stageData.project.asrConfig.unintelligiblePlaceholder ?? '**inaudible**', 'voice', asrEndMs);
          }
        });

        asrProvider.setOnError(async (error: Error) => {
          logger.error({ conversationId, error: error.message, isRecognizing }, `ASR error for conversation ${conversationId}: ${error.message}`);
          if (isRecognizing) {
            isRecognizing = false;
            await this.markAsFailed(`ASR error: ${error.message}`);
          }
        });

        logger.info({ conversationId }, `ASR provider initialized for conversation ${conversationId}`);

        // Set up inbound audio converter (client send format → ASR input format)
        await this.setupInboundConverter(asrProvider, conversationId);
      } catch (error) {
        logger.error({ conversationId, error: error instanceof Error ? error.message : String(error) }, `Failed to initialize ASR provider for conversation ${conversationId}`);
        throw error;
      }
    }

    // Initialize and wire up TTS provider
    if (ttsProvider) {
      try {
        await ttsProvider.init();

        // Negotiate TTS output format with the client's preference (must happen before start())
        const receiveAudioFormat = this.session.sessionSettings.receiveAudioFormat ?? 'pcm_16000';
        const ttsNativeFormat = ttsProvider.getSupportedFormats()[0];
          //? ttsProvider.setPreferredOutputFormat(receiveAudioFormat)
          //: ttsProvider.setPreferredOutputFormat('pcm_16000'); // default to pcm_16000 if client doesn't specify

        // Set up outbound audio converter (TTS native format → client preferred format) if there is a gap
        await this.setupOutboundConverter(ttsNativeFormat, receiveAudioFormat ?? ttsNativeFormat, conversationId);

        let firstTtsChunkGenerated = false;
        let isGenerating = false;

        ttsProvider.setOnGenerationStarted(async () => {
          logger.info({ conversationId }, `TTS generation started for conversation ${conversationId}`);
          isGenerating = true;
          firstTtsChunkGenerated = false;
          if (this.turnData.ttsStartMs === null) {
            this.turnData.ttsStartMs = Date.now();
          }
        });

        ttsProvider.setOnGenerationEnded(async () => {
          logger.info({ conversationId }, `TTS generation ended for conversation ${conversationId}`);
          firstTtsChunkGenerated = false;
          isGenerating = false;

          // Snapshot turn data before any awaits to avoid reading mutated values
          const { startMs, assistantMessageEventId, outputTurnId, ttsStartMs } = this.turnData;
          const ttsEndMs = Date.now();

          // Record total turn duration and TTS duration now that all audio has been sent
          const totalTurnDurationMs = startMs !== null ? ttsEndMs - startMs : undefined;
          const ttsDurationMs = ttsStartMs !== null ? ttsEndMs - ttsStartMs : undefined;
          if (assistantMessageEventId) {
            const backfill: Record<string, any> = {};
            if (totalTurnDurationMs !== undefined) backfill.totalTurnDurationMs = totalTurnDurationMs;
            if (ttsDurationMs !== undefined) backfill.ttsDurationMs = ttsDurationMs;
            if (Object.keys(backfill).length > 0) {
              const updated = await this.conversationService.updateConversationEventMetadata(this.conversation.projectId, assistantMessageEventId, backfill);
              const eventUpdateMessage: CALConversationEventUpdateMessage = {
                type: 'conversation_event_update',
                conversationId: this.conversation.id,
                eventType: 'message',
                eventData: updated.eventData,
                inputTurnId: this.turnData.inputTurnId,
                outputTurnId: this.turnData.outputTurnId,
              };
              await this.channel.sendMessage(eventUpdateMessage);
            }
          }

          // Send AI response end notification to client through channel
          // TODO: we need a dedicated message for sending full text after TTS generation is complete, as end_ai_voice_output is more about signaling the end of audio output, not necessarily tied to the text content
          const endMessage: CALEndAiGenerationOutputMessage = {
            type: 'end_ai_generation_output',
            conversationId,
            outputTurnId,
            fullText: extractTextFromContent(this.stageData.lastCompletionResult?.content ?? []),
          };
          await this.channel.sendMessage(endMessage);

          await this.changeState('awaiting_user_input'); // TODO: handle end/aborted/failed states appropriately
        });

        ttsProvider.setOnSpeechGenerating(async (chunk) => {
          if (!firstTtsChunkGenerated) {
            logger.info({ conversationId, chunkId: chunk.chunkId }, `First TTS chunk generated for conversation ${conversationId}`);
            firstTtsChunkGenerated = true;
            // Reset per-turn outbound converter state on first chunk of each TTS turn
            this.outboundConverter?.reset();
            this.outboundOrdinalCounter = 0;
            this.outboundPendingChunk = null;
            // Record the timestamp of the first audio chunk if not already captured
            if (this.turnData.firstAudioMs === null) {
              this.turnData.firstAudioMs = Date.now();
            }
          }

          if (this.outboundConverter) {
            // Converter path: push audio into the converter; it emits 'data' for each output chunk
            this.outboundConverter.push(chunk.audio);
            if (chunk.isFinal) {
              this.outboundConverter.end();
            }
            logger.debug({ conversationId, chunkId: chunk.chunkId, ordinal: chunk.ordinal, isFinal: chunk.isFinal }, `TTS chunk pushed to outbound converter for conversation ${conversationId}`);
          } else {
            // Direct path: no conversion needed — send straight to the client
            const voiceChunkMessage: CALSendAiVoiceChunkMessage = {
              type: 'send_ai_voice_chunk',
              conversationId,
              outputTurnId: this.turnData.outputTurnId,
              audioData: chunk.audio,
              audioFormat: chunk.audioFormat,
              chunkId: chunk.chunkId,
              ordinal: chunk.ordinal,
              isFinal: chunk.isFinal,
            };
            await this.channel.sendMessage(voiceChunkMessage);
            logger.debug({ conversationId, chunkId: chunk.chunkId, ordinal: chunk.ordinal, isFinal: chunk.isFinal }, `TTS chunk generated for conversation ${conversationId}`);

            if (chunk.isFinal) {
              logger.info({ conversationId }, `TTS generation completed for conversation ${conversationId}`);
              firstTtsChunkGenerated = false;
            }
          }
        });

        ttsProvider.setOnError(async (error: Error) => {
          logger.error({ conversationId, error: error.message }, `TTS error for conversation ${conversationId}: ${error.message}`);
          if (isGenerating) {
            isGenerating = false;
            await this.markAsFailed(`TTS error: ${error.message}`);
          }
        });

        logger.info({ conversationId }, `TTS provider initialized for conversation ${conversationId}`);
      } catch (error) {
        logger.error({ conversationId, error: error instanceof Error ? error.message : String(error) }, `Failed to initialize TTS provider for conversation ${conversationId}`);
        throw error;
      }
    }

    // Initialize and wire up completion LLM provider
    if (completionLlmProvider) {
      let aiTextChunkOrdinal = 0;

      completionLlmProvider.setOnChunk(async (chunk: LlmChunk) => {
        logger.debug({ conversationId, chunkLength: chunk.content.length }, `LLM completion chunk for conversation ${conversationId}: ${chunk.content.length} characters`);
        // Record the timestamp of the first token if not already captured
        if (this.turnData.firstTokenMs === null && this.turnData.llmStartMs !== null) {
          this.turnData.firstTokenMs = Date.now();
        }
        if (ttsProvider) {
          // Pass chunk text to TTS provider for speech synthesis
          await ttsProvider.sendText(chunk.content);
        }

        // Send completion chunk to client through channel
        const aiChunkMessage: CALAiTranscribedChunkMessage = {
          type: 'ai_transcribed_chunk',
          conversationId,
          outputTurnId: this.turnData.outputTurnId,
          chunkId: generateId(ID_PREFIXES.CHUNK),
          chunkText: chunk.content,
          ordinal: aiTextChunkOrdinal++,
          isFinal: chunk.finishReason !== null,
        };
        await this.channel.sendMessage(aiChunkMessage);
      });

      completionLlmProvider.setOnGenerationCompleted(async (result) => {
        const textContent = extractTextFromContent(result.content);
        const contentSize = getContentSize(result.content);
        const llmEndMs = Date.now();

        logger.info({ conversationId, totalTokens: result.usage?.totalTokens, contentBlocks: result.content.length }, `LLM completion finished for conversation ${conversationId}: ${contentSize} bytes in ${result.content.length} content blocks, ${result.usage?.totalTokens} tokens used`);
        this.stageData.lastCompletionResult = result;

        // Compute turn timings available at LLM completion time
        const llmDurationMs = this.turnData.llmStartMs !== null ? llmEndMs - this.turnData.llmStartMs : undefined;
        const timeToFirstTokenMs = this.turnData.firstTokenMs !== null && this.turnData.llmStartMs !== null ? this.turnData.firstTokenMs - this.turnData.llmStartMs : undefined;
        const timeToFirstTokenFromTurnStartMs = this.turnData.firstTokenMs !== null && this.turnData.startMs !== null ? this.turnData.firstTokenMs - this.turnData.startMs : undefined;
        const timeToFirstAudioMs = this.turnData.firstAudioMs !== null && this.turnData.startMs !== null ? this.turnData.firstAudioMs - this.turnData.startMs : undefined;
        // For the text-only path, total turn duration is known now; for the TTS path it will be updated in setOnGenerationEnded
        const totalTurnDurationMs = !ttsProvider && this.turnData.startMs !== null ? llmEndMs - this.turnData.startMs : undefined;

        // Save AI message event with usage info and timing metrics
        const messageEventData: MessageEventData = {
          text: textContent,
          role: 'assistant',
          originalText: textContent,
          visibility: this.turnMessageVisibility,
          metadata: {
            llmUsage: result.usage || {},
            systemPrompt: this.stageData.lastCompletionPrompt,
            llmSettings: this.stageData.stage.llmSettings,
            outputTurnId: this.turnData.outputTurnId,
            turnIndex: this.turnData.turnIndex,
            llmDurationMs,
            timeToFirstTokenMs,
            timeToFirstTokenFromTurnStartMs,
            timeToFirstAudioMs,
            totalTurnDurationMs,
            moderationDurationMs: this.turnData.moderationDurationMs ?? undefined,
            fillerPrompt: this.lastFillerPrompt ?? undefined,
          },
        };
        this.turnData.assistantMessageEventId = await this.saveAndSendEvent('message', messageEventData);

        if (!ttsProvider) {
          // send end generation message to client to signal that response is complete and change state to awaiting user input
          const endGenerationMessage: CALEndAiGenerationOutputMessage = {
            type: 'end_ai_generation_output',
            conversationId,
            outputTurnId: this.turnData.outputTurnId,
            fullText: textContent,
          };
          await this.channel.sendMessage(endGenerationMessage);

          await this.changeState('awaiting_user_input'); // In case of no TTS provider, change state to awaiting user input
        } else {
          await ttsProvider.end(); // Signal TTS provider that generation is complete so it can finalize audio output and notify client
        }
      });


      completionLlmProvider.setOnError(async (error: Error) => {
        logger.error({ conversationId, error: error.message }, `LLM completion error for conversation ${conversationId}: ${error.message}`);
        await this.markAsFailed(`LLM completion error: ${error.message}`);
      });

      logger.info({ conversationId, stageId: this.stageData.id }, `Completion LLM provider wired up for conversation ${conversationId}`);
    } else {
      logger.warn({ conversationId, stageId: this.stageData.id }, `No completion LLM provider available for conversation ${conversationId}`);
    }

    // Wire up classification LLM providers
    for (const classifierData of this.stageData.classifiers) {
      try {
        classifierData.llmProvider.setOnError(async (error: Error) => {
          logger.error({ conversationId, classifierId: classifierData.classifier.id, error: error.message }, `LLM classification error for conversation ${conversationId}: ${error.message}`);
          await this.markAsFailed(`LLM classification error: ${error.message}`);
        });

        logger.info({ conversationId, classifierId: classifierData.classifier.id }, `Classification LLM provider wired up for classifier ${classifierData.classifier.name}`);
      } catch (error) {
        logger.error({ conversationId, classifierId: classifierData.classifier.id, error: error instanceof Error ? error.message : String(error) }, `Failed to wire up classification LLM provider for classifier ${classifierData.classifier.id}`);
      }
    }

    // Wire up transformer LLM providers
    for (const transformerData of this.stageData.transformers) {
      try {
        transformerData.llmProvider.setOnError(async (error: Error) => {
          logger.error({ conversationId, transformerId: transformerData.transformer.id, error: error.message }, `LLM transformer error for conversation ${conversationId}: ${error.message}`);
          await this.markAsFailed(`LLM transformer error: ${error.message}`);
        });

        logger.info({ conversationId, transformerId: transformerData.transformer.id }, `Transformer LLM provider wired up for transformer ${transformerData.transformer.name}`);
      } catch (error) {
        logger.error({ conversationId, transformerId: transformerData.transformer.id, error: error instanceof Error ? error.message : String(error) }, `Failed to wire up transformer LLM provider for transformer ${transformerData.transformer.id}`);
      }
    }
  }

  async startConversation() {
    this.responseGeneratedInTurn = false;
    this.resetTurnData();
    if (this.conversation.status !== 'initialized') {
      throw new Error(`Cannot start conversation in current state: ${this.conversation.status}`);
    }

    const eventData: ConversationStartEventData = {
      stageId: this.stageData.id,
      initialVariables: this.conversation.stageVars?.[this.stageData.id] || {},
    };
    await this.saveAndSendEvent('conversation_start', eventData);
    logger.info({ conversationId: this.conversation.id, stageId: this.stageData.id }, 'Conversation started');

    const context = await this.contextBuilder.buildContextForConversationStart(this.conversation);

    // Execute __conversation_start global lifecycle action if defined
    const onConversationStartAction = this.conversationLifecycleActions.get(CONVERSATION_LIFECYCLE_ACTION_IDS.ON_START);
    if (onConversationStartAction) {
      logger.debug({ conversationId: this.conversation.id }, 'Executing __conversation_start lifecycle action');
      const startOutcome = await this.actionsExecutor.executeActions([onConversationStartAction], context, 'conversation_start');
      await this.applyActionOutcome(context, startOutcome);
      await this.saveAndSendOutcomeEvents(startOutcome);
      const actionEventData: ActionEventData = { actionName: onConversationStartAction.name || '', stageId: this.stageData.id, effects: onConversationStartAction.effects };
      await this.saveAndSendEvent('action', actionEventData);
    }

    // Execute __on_enter lifecycle action if defined
    let enterOutcome: ActionsExecutionOutcome | null = null;
    const onEnterAction = this.stageData.stage.actions[LIFECYCLE_ACTION_NAMES.ON_ENTER];
    if (onEnterAction) {
      enterOutcome = await this.actionsExecutor.executeActions([onEnterAction], context, 'on_enter');
      await this.applyActionOutcome(context, enterOutcome);

      // Save/send tool call events from action execution
      await this.saveAndSendOutcomeEvents(enterOutcome);

      // Register action event
      const actionEventData: ActionEventData = {
        actionName: onEnterAction.name || '',
        stageId: this.stageData.id,
        effects: onEnterAction.effects,
      };
      await this.saveAndSendEvent('action', actionEventData);

      // If on_enter ended or aborted conversation, don't proceed
      if (enterOutcome.shouldEndConversation || enterOutcome.shouldAbortConversation) {
        return;
      }
    }

    if (enterOutcome?.shouldGenerateResponse) {
      // on_enter action explicitly requested a response (may include a prescripted response)
      await this.generateResponse(context, enterOutcome);
    } else if (this.stageData.stage.enterBehavior === 'generate_response') {
      const outcome: ActionsExecutionOutcome = {
        hasModifiedUserInput: false,
        hasModifiedUserProfile: false,
        hasModifiedVars: false,
        success: true,
        shouldAbortConversation: false,
        shouldEndConversation: false,
        shouldGenerateResponse: true
      };
      await this.generateResponse(context, outcome);
    } else {
      await this.changeState('awaiting_user_input');
    }
  }

  async resumeConversation() {
    // Validate conversation can be resumed (should already be checked in prepareConversation, but double-check)
    if (this.conversation.status === 'finished' || this.conversation.status === 'failed' || this.conversation.status === 'aborted') {
      throw new Error(`Cannot resume conversation in state: ${this.conversation.status}`);
    }

    const previousStatus = this.conversation.status;
    const eventData: ConversationResumeEventData = {
      previousStatus,
      stageId: this.stageData.id,
    };
    await this.saveAndSendEvent('conversation_resume', eventData);
    logger.info({ conversationId: this.conversation.id, previousStatus, stageId: this.stageData.id }, 'Conversation resumed');

    // Execute __conversation_resume global lifecycle action if defined
    const onConversationResumeAction = this.conversationLifecycleActions.get(CONVERSATION_LIFECYCLE_ACTION_IDS.ON_RESUME);
    if (onConversationResumeAction) {
      logger.debug({ conversationId: this.conversation.id }, 'Executing __conversation_resume lifecycle action');
      const resumeContext = await this.contextBuilder.buildContextForConversationStart(this.conversation);
      const resumeOutcome = await this.actionsExecutor.executeActions([onConversationResumeAction], resumeContext, 'conversation_resume');
      await this.applyActionOutcome(resumeContext, resumeOutcome);
      await this.saveAndSendOutcomeEvents(resumeOutcome);
      const actionEventData: ActionEventData = { actionName: onConversationResumeAction.name || '', stageId: this.stageData.id, effects: onConversationResumeAction.effects };
      await this.saveAndSendEvent('action', actionEventData);
    }

    // Resume to awaiting user input state to allow the user to continue
    await this.changeState('awaiting_user_input');
  }

  /**
   * Executes the __conversation_end lifecycle global action (if configured) when the conversation
   * is ended via an explicit client command. Returns the stageId so the caller can include it in
   * the conversation_end event.
   */
  async executeEndLifecycleAction(): Promise<void> {
    const onConversationEndAction = this.conversationLifecycleActions.get(CONVERSATION_LIFECYCLE_ACTION_IDS.ON_END);
    if (!onConversationEndAction) return;
    logger.debug({ conversationId: this.conversation.id }, 'Executing __conversation_end lifecycle action (client command)');
    const endContext = await this.contextBuilder.buildContextForConversationStart(this.conversation);
    const endOutcome = await this.actionsExecutor.executeActions([onConversationEndAction], endContext, 'conversation_end');
    await this.applyActionOutcome(endContext, endOutcome);
    await this.saveAndSendOutcomeEvents(endOutcome);
    const actionEventData: ActionEventData = { actionName: onConversationEndAction.name || '', stageId: this.stageData.id, effects: onConversationEndAction.effects };
    await this.saveAndSendEvent('action', actionEventData);
  }

  async receiveUserTextInput(userInput: string): Promise<string> {
    if (this.conversation.status !== 'awaiting_user_input') {
      throw new Error(`Cannot receive user input in current state: ${this.conversation.status}`);
    }

    this.turnData.inputTurnId = generateId(ID_PREFIXES.INPUT);
    await this.processUserInput(userInput, 'text');
    return this.turnData.inputTurnId;
  }

  async startUserVoiceInput(): Promise<string> {
    if (this.conversation.status !== 'awaiting_user_input') {
      throw new Error(`Cannot start receiving user voice input in current state: ${this.conversation.status}`);
    }

    if (!this.stageData.asrProvider) {
      const errorMessage = `ASR provider not available for conversation ${this.stageData.conversation.id}`;
      await this.markAsFailed(errorMessage);
      throw new Error(errorMessage);
    }

    try {
      this.turnData.inputTurnId = generateId(ID_PREFIXES.INPUT);
      // Reset the inbound converter state for this new turn (reuses the session-scoped instance)
      this.inboundConverter?.reset();
      await this.stageData.asrProvider.start();
      await this.changeState('receiving_user_voice');
      logger.info({ conversationId: this.stageData.conversation.id }, `Started voice input for conversation ${this.stageData.conversation.id}`);
      return this.turnData.inputTurnId;
    } catch (error) {
      const errorMessage = `Failed to start voice input: ${error instanceof Error ? error.message : String(error)}`;
      await this.markAsFailed(errorMessage);
      logger.error({ conversationId: this.stageData.conversation.id, error: error instanceof Error ? error.message : String(error) }, `Failed to start voice input for conversation ${this.stageData.conversation.id}`);
      throw error;
    }
  }

  async receiveUserVoiceData(inputTurnId: string, voiceData: Buffer) {
    if (this.conversation.status !== 'receiving_user_voice') {
      throw new Error(`Cannot receive user voice data in current state: ${this.conversation.status}`);
    }

    if (this.turnData.inputTurnId !== inputTurnId) {
      throw new Error(`Input turn ID mismatch: expected ${this.turnData.inputTurnId}, got ${inputTurnId}`);
    }

    if (!this.stageData.asrProvider) {
      const errorMessage = `ASR provider not available for conversation ${this.stageData.conversation.id}`;
      await this.markAsFailed(errorMessage);
      throw new Error(errorMessage);
    }

    try {
      if (this.inboundConverter) {
        // Route through the inbound converter; the converter's 'data' handler forwards to ASR
        this.inboundConverter.push(voiceData);
      } else {
        await this.stageData.asrProvider.sendAudio(voiceData);
      }
      logger.debug({ conversationId: this.stageData.conversation.id, bufferSize: voiceData.length }, `Sent ${voiceData.length} bytes of audio data for conversation ${this.stageData.conversation.id}`);
    } catch (error) {
      const errorMessage = `Failed to process voice data: ${error instanceof Error ? error.message : String(error)}`;
      await this.markAsFailed(errorMessage);
      logger.error({ conversationId: this.stageData.conversation.id, error: error instanceof Error ? error.message : String(error) }, `Failed to send audio data for conversation ${this.stageData.conversation.id}`);
      throw error;
    }
  }

  async stopUserVoiceInput(inputTurnId: string) {
    if (this.conversation.status !== 'receiving_user_voice') {
      throw new Error(`Cannot stop receiving user voice input in current state: ${this.conversation.status}`);
    }
    if (this.turnData.inputTurnId !== inputTurnId) {
      throw new Error(`Input turn ID mismatch: expected ${this.turnData.inputTurnId}, got ${inputTurnId}`);
    }

    if (!this.stageData.asrProvider) {
      const errorMessage = `ASR provider not available for conversation ${this.stageData.conversation.id}`;
      await this.markAsFailed(errorMessage);
      throw new Error(errorMessage);
    }

    try {
      // Signal end of input to the inbound converter so it can flush any buffered data to ASR
      this.inboundConverter?.end();
      await this.stageData.asrProvider.stop();
      await this.changeState('processing_user_input');

      logger.info({ conversationId: this.stageData.conversation.id }, `Stopped voice input for conversation ${this.stageData.conversation.id}`);
    } catch (error) {
      const errorMessage = `Failed to stop voice input: ${error instanceof Error ? error.message : String(error)}`;
      await this.markAsFailed(errorMessage);
      logger.error({ conversationId: this.stageData.conversation.id, error: error instanceof Error ? error.message : String(error) }, `Failed to stop voice input for conversation ${this.stageData.conversation.id}`);
      throw error;
    }
  }

  async receiveCommand(command: string, data: any) {
    throw new Error("Method not implemented.");
  }

  /**
   * Saves a command event for the current conversation.
   * @param command - The type of command received
   * @param parameters - Optional parameters associated with the command
   */
  async saveCommandEvent(command: CommandType, parameters?: Record<string, any>): Promise<void> {
    const eventData: CommandEventData = { command, parameters };
    await this.saveAndSendEvent('command', eventData);
  }

  /**
   * Releases all ASR, TTS, and LLM provider resources held by this runner.
   * Must be called when the associated WebSocket connection closes so that sockets,
   * HTTP streams, and SDK sessions are properly torn down and do not leak.
   */
  async cleanup(): Promise<void> {
    const conversationId = this.stageData?.conversation?.id ?? 'unknown';
    logger.info({ conversationId }, 'Cleaning up ConversationRunner resources');

    const cleanupProvider = async (provider: { cleanup(): Promise<void> } | undefined, label: string) => {
      if (!provider) return;
      try {
        await provider.cleanup();
      } catch (error) {
        logger.error({ conversationId, error: error instanceof Error ? error.message : String(error) }, `Failed to clean up ${label} for conversation ${conversationId}`);
      }
    };

    // Destroy session-scoped audio converters
    this.inboundConverter?.destroy();
    this.inboundConverter = null;
    this.outboundConverter?.destroy();
    this.outboundConverter = null;

    if (this.stageData) {
      await cleanupProvider(this.stageData.asrProvider, 'ASR provider');
      await cleanupProvider(this.stageData.ttsProvider, 'TTS provider');
      await cleanupProvider(this.stageData.completionLlmProvider, 'completion LLM provider');
      await cleanupProvider(this.stageData.fillerLlmProvider, 'filler LLM provider');
      for (const classifierData of this.stageData.classifiers) {
        await cleanupProvider(classifierData.llmProvider, `classifier LLM provider (${classifierData.classifier.id})`);
      }
      if (this.stageData.guardrailClassifier) {
        await cleanupProvider(this.stageData.guardrailClassifier.llmProvider, `guardrail classifier LLM provider (${this.stageData.guardrailClassifier.classifier.id})`);
      }
      for (const transformerData of this.stageData.transformers) {
        await cleanupProvider(transformerData.llmProvider, `transformer LLM provider (${transformerData.transformer.id})`);
      }
    }

    logger.info({ conversationId }, 'ConversationRunner cleanup complete');
  }

  /**
   * Navigate to a specific stage in the conversation
   * @param stageId - ID of the stage to navigate to
   */
  async goToStage(stageId: string, isProcessingUserInput: boolean = false): Promise<void> {
    // Track nesting depth so only the outermost goToStage call resets the per-turn response guard.
    // This prevents chained on_enter stage jumps from each generating their own response.
    const isTopLevel = this.navigationDepth === 0;
    this.navigationDepth++;
    if (isTopLevel) {
      this.responseGeneratedInTurn = false;
      // Only reset turn timing for top-level (client-initiated) navigation; internal goToStage
      // calls triggered mid-turn by applyActionOutcome must preserve the ongoing turn's data.
      if (!isProcessingUserInput) {
        this.resetTurnData();
      }
    }

    try {
      logger.info({ conversationId: this.conversation.id, currentStageId: this.stageData.id, targetStageId: stageId }, `Navigating to stage ${stageId}`);

      const allowed = isProcessingUserInput
        ? this.conversation.status === 'awaiting_user_input' || this.conversation.status === 'processing_user_input'
        : this.conversation.status === 'awaiting_user_input';
      if (!allowed) {
        throw new Error(`Cannot navigate to stage in current state: ${this.conversation.status}`);
      }

      const fromStageId = this.stageData.id;
      const oldStageData = this.stageData;

      // Execute __on_leave lifecycle action if defined on current stage
      const onLeaveAction = oldStageData.stage.actions[LIFECYCLE_ACTION_NAMES.ON_LEAVE];
      if (onLeaveAction) {
        logger.debug({ conversationId: this.conversation.id, stageId: fromStageId }, 'Executing __on_leave lifecycle action');
        const context = await this.contextBuilder.buildContextForUserInput(oldStageData.conversation, oldStageData.stage, [/** TODO */], '-', '-');
        const leaveOutcome = await this.actionsExecutor.executeActions([onLeaveAction], context, 'on_leave');

        await this.applyActionOutcome(context, leaveOutcome);

        // Save/send tool call events from action execution
        await this.saveAndSendOutcomeEvents(leaveOutcome);

        // Register action event
        const actionEventData: ActionEventData = {
          actionName: onLeaveAction.name || '',
          stageId: oldStageData.id,
          effects: onLeaveAction.effects,
        };
        await this.saveAndSendEvent('action', actionEventData);

        // If on_leave ended or aborted conversation, don't proceed
        if (leaveOutcome.shouldEndConversation || leaveOutcome.shouldAbortConversation) {
          return;
        }
      }

      // Update stageId on this.conversation before building new stage data.
      // This keeps stageData.conversation as the same object reference as this.conversation,
      // so any subsequent applyActionOutcome writes to this.conversation.stageVars are
      // immediately visible via getRuntimeData().conversation on the next turn.
      this.conversation.stageId = stageId;

      // Update conversation in database
      await db.update(conversations)
        .set({ stageId, updatedAt: new Date() })
        .where(and(eq(conversations.projectId, this.conversation.projectId), eq(conversations.id, this.conversation.id)));

      // Load new stage data, passing this.conversation directly (not a spread copy)
      const newStageData = await this.buildStageData(this.conversation);
      this.stageData = newStageData;

      // Re-wire providers for the new stage
      await this.wireUpProviders();

      const eventData: JumpToStageEventData = {
        fromStageId,
        toStageId: stageId,
      };
      await this.saveAndSendEvent('jump_to_stage', eventData);

      // Execute __on_enter lifecycle action if defined on new stage
      const enterContext = await this.contextBuilder.buildContextForUserInput(this.stageData.conversation, this.stageData.stage, [ /** TODO */], '-', '-');
      let enterOutcome: ActionsExecutionOutcome | null = null;
      const onEnterAction = this.stageData.stage.actions[LIFECYCLE_ACTION_NAMES.ON_ENTER];
      if (onEnterAction) {
        logger.debug({ conversationId: this.conversation.id, stageId }, 'Executing __on_enter lifecycle action');
        enterOutcome = await this.actionsExecutor.executeActions([onEnterAction], enterContext, 'on_enter');

        await this.applyActionOutcome(enterContext, enterOutcome);

        // Save/send tool call events from action execution
        await this.saveAndSendOutcomeEvents(enterOutcome);

        // Register action event
        const actionEventData: ActionEventData = {
          actionName: onEnterAction.name || '',
          stageId: this.stageData.id,
          effects: onEnterAction.effects,
        };
        await this.saveAndSendEvent('action', actionEventData);

        // If on_enter ended or aborted conversation, don't proceed
        if (enterOutcome.shouldEndConversation || enterOutcome.shouldAbortConversation) {
          return;
        }
      }

      if (enterOutcome?.shouldGenerateResponse) {
        // on_enter action explicitly requested a response (may include a prescripted response)
        await this.generateResponse(enterContext, enterOutcome);
      } else if (this.stageData.stage.enterBehavior === 'generate_response') {
        const executionOutcome: ActionsExecutionOutcome = {
          hasModifiedUserInput: false,
          hasModifiedUserProfile: false,
          hasModifiedVars: false,
          success: true,
          shouldAbortConversation: false,
          shouldEndConversation: false,
          shouldGenerateResponse: true
        };
        await this.generateResponse(enterContext, executionOutcome);
      } else {
        await this.changeState('awaiting_user_input');
      }

      logger.info({ conversationId: this.conversation.id, stageId }, `Successfully navigated to stage ${stageId}`);
    } finally {
      this.navigationDepth--;
    }
  }

  /**
   * Set a variable value in the conversation context
   * @param stageId - ID of the stage (for validation)
   * @param variableName - Name of the variable to set
   * @param variableValue - Value to set
   */
  async setVariable(stageId: string, variableName: string, variableValue: any): Promise<void> {
    if (this.stageData.id !== stageId) {
      throw new Error(`Stage ID mismatch: expected ${this.stageData.id}, got ${stageId}`);
    }
    if (this.conversation.status !== 'awaiting_user_input') {
      throw new Error(`Cannot set variable in current state: ${this.conversation.status}`);
    }


    logger.debug({ conversationId: this.conversation.id, stageId, variableName }, `Setting variable ${variableName}`);

    // Initialize stageVars if it doesn't exist
    if (!this.conversation.stageVars) {
      this.conversation.stageVars = {};
    }

    // Initialize stage-specific vars if they don't exist
    if (!this.conversation.stageVars[stageId]) {
      this.conversation.stageVars[stageId] = {};
    }

    // Set the variable for this stage
    this.conversation.stageVars[stageId][variableName] = variableValue;

    // Update conversation in database
    await db.update(conversations)
      .set({ stageVars: this.conversation.stageVars, updatedAt: new Date() })
      .where(and(eq(conversations.projectId, this.conversation.projectId), eq(conversations.id, this.conversation.id)));

    logger.debug({ conversationId: this.conversation.id, stageId, variableName }, `Successfully set variable ${variableName}`);
  }

  /**
   * Get a variable value from the conversation context
   * @param stageId - ID of the stage (for validation)
   * @param variableName - Name of the variable to retrieve
   * @returns The variable value or undefined if not found
   */
  async getVariable(stageId: string, variableName: string): Promise<any> {
    if (this.stageData.id !== stageId) {
      throw new Error(`Stage ID mismatch: expected ${this.stageData.id}, got ${stageId}`);
    }

    logger.debug({ conversationId: this.conversation.id, stageId, variableName }, `Getting variable ${variableName}`);

    const value = this.conversation.stageVars?.[stageId]?.[variableName];

    logger.debug({ conversationId: this.conversation.id, stageId, variableName, hasValue: value !== undefined }, `Retrieved variable ${variableName}`);

    return value;
  }

  /**
   * Get all variables from the conversation context
   * @param stageId - ID of the stage (for validation)
   * @returns Object containing all variables
   */
  async getAllVariables(stageId: string): Promise<Record<string, any>> {
    if (this.stageData.id !== stageId) {
      throw new Error(`Stage ID mismatch: expected ${this.stageData.id}, got ${stageId}`);
    }

    logger.debug({ conversationId: this.conversation.id, stageId }, `Getting all variables`);

    const variables = this.conversation.stageVars?.[stageId] || {};

    logger.debug({ conversationId: this.conversation.id, stageId, variableCount: Object.keys(variables).length }, `Retrieved all variables`);

    return variables;
  }

  /**
   * Set a user profile field value
   * @param fieldName - Name of the profile field to set
   * @param fieldValue - Value to set
   */
  async setUserProfileField(fieldName: string, fieldValue: any): Promise<void> {
    logger.info({ conversationId: this.conversation.id, fieldName }, `Setting user profile field ${fieldName}`);

    // Load current user from database
    const currentUser = await db.query.users.findFirst({
      where: and(eq(users.projectId, this.conversation.projectId), eq(users.id, this.conversation.userId)),
    });

    if (!currentUser) {
      throw new NotFoundError(`User with ID ${this.conversation.userId} not found in project ${this.conversation.projectId}`);
    }

    // Update profile field
    const updatedProfile = { ...currentUser.profile };
    if (fieldValue === undefined) {
      delete updatedProfile[fieldName];
    } else {
      updatedProfile[fieldName] = fieldValue;
    }

    // Update user in database
    await db.update(users)
      .set({ profile: updatedProfile, updatedAt: new Date() })
      .where(and(eq(users.projectId, this.conversation.projectId), eq(users.id, this.conversation.userId)));

    logger.info({ conversationId: this.conversation.id, fieldName }, `Successfully set user profile field ${fieldName}`);
  }

  /**
   * Get a user profile field value
   * @param fieldName - Name of the profile field to retrieve
   * @returns The field value or undefined if not found
   */
  async getUserProfileField(fieldName: string): Promise<any> {
    logger.info({ conversationId: this.conversation.id, fieldName }, `Getting user profile field ${fieldName}`);

    const user = await db.query.users.findFirst({
      where: and(eq(users.projectId, this.conversation.projectId), eq(users.id, this.conversation.userId)),
    });

    if (!user) {
      throw new NotFoundError(`User with ID ${this.conversation.userId} not found in project ${this.conversation.projectId}`);
    }

    const value = user.profile[fieldName];

    logger.info({ conversationId: this.conversation.id, fieldName, hasValue: value !== undefined }, `Retrieved user profile field ${fieldName}`);

    return value;
  }

  /**
   * Execute a global action
   * @param actionName - Name of the action to execute
   * @param parameters - Array of parameters to pass to the action
   * @returns Result of the action execution
   */
  async runAction(actionName: string, parameters: Record<string, any>): Promise<any> {
    logger.info({ conversationId: this.conversation.id, actionName, parameterCount: parameters.length }, `Running action ${actionName}`);

    if (this.conversation.status !== 'awaiting_user_input') {
      throw new Error(`Cannot run action in current state: ${this.conversation.status}`);
    }

    // Reset per-turn data so timing fields are clean for this client-initiated action turn,
    // just like processUserInput does at the start of each user turn.
    this.responseGeneratedInTurn = false;
    this.resetTurnData();

    // Load the action from the database
    const globalAction = await db.query.globalActions.findFirst({
      where: (globalActions, { and, eq }) => and(
        eq(globalActions.projectId, this.stageData.project.id),
        eq(globalActions.name, actionName)
      )
    });

    const stageAction = this.stageData.stage.actions[actionName];

    if (!globalAction && !stageAction) {
      throw new NotFoundError(`Action ${actionName} not found in project ${this.stageData.project.id}`);
    }

    const actionToExecute = stageAction || globalAction;
    logger.info({ conversationId: this.conversation.id, actionName }, `Executing action ${actionName}`);
    const context = await this.contextBuilder.buildContextForAction(this.stageData.conversation, actionName, actionToExecute, parameters);
    logger.debug({ conversationId: this.conversation.id, actionName }, `Built context for action ${actionName}`);
    const outcome = await this.actionsExecutor.executeActions([actionToExecute], context);

    // Save/send tool call events from action execution
    await this.saveAndSendOutcomeEvents(outcome);

    // Register action event
    const actionEventData: ActionEventData = {
      actionName,
      stageId: this.stageData.id,
      effects: actionToExecute.effects,
    };
    await this.saveAndSendEvent('action', actionEventData);

    if (await this.applyActionOutcome(context, outcome)) {
      // TODO: this needs more thought
      await this.generateResponse(context, outcome);
    }

    logger.info({ conversationId: this.conversation.id, actionName }, `Action ${actionName} executed`);
    return { status: 'completed', message: 'Action execution not yet implemented' };
  }

  /**
   * Execute a tool
   * @param toolId - ID of the tool to execute
   * @param parameters - Map of parameter names to their values
   * @returns Result of the tool execution
   */
  async callTool(toolId: string, parameters: Record<string, any>): Promise<any> {
    logger.info({ conversationId: this.conversation.id, toolId, parameterCount: Object.keys(parameters).length }, `Calling tool ${toolId}`);

    // Load the tool from the database
    const tool = await db.query.tools.findFirst({
      where: (tools, { and, eq }) => and(eq(tools.projectId, this.stageData.project.id), eq(tools.id, toolId))
    });

    if (!tool) {
      throw new NotFoundError(`Tool with id ${toolId} not found`);
    }

    logger.info({ conversationId: this.conversation.id, toolId, toolName: tool.name }, `Executing tool ${tool.name}`);

    // Build conversation context for tool execution
    const context = await this.contextBuilder.buildContextForUserInput(this.stageData.conversation, this.stageData.stage, [], '', '');

    // Execute the tool
    const executeResult = await this.toolExecutor.executeTool(tool, context, parameters);

    // Save tool call event
    const eventData: ToolCallEventData = {
      toolId: tool.id,
      toolName: tool.name,
      toolType: tool.type,
      parameters,
      success: executeResult.success,
      result: executeResult.result,
      error: executeResult.failureReason,
      metadata: {
        systemPrompt: executeResult.renderedPrompt,
        llmSettings: executeResult.llmSettings,
        durationMs: executeResult.durationMs,
      }
    };
    await this.saveAndSendEvent('tool_call', eventData);

    logger.info({ conversationId: this.conversation.id, toolId, success: executeResult.success, result: executeResult.result }, `Tool ${tool.name} executed`);

    return executeResult;
  }

  /**
   * Applies the outcome of action execution to the conversation state
   * @param outcome Result from executing actions
   * @return True if continue execution, false if conversation failed, ended or aborted
   */
  private async applyActionOutcome(context: ConversationContext, outcome: ActionsExecutionOutcome): Promise<boolean> {
    const conversationId = this.conversation.id;

    if (!outcome.success) {
      logger.error({ conversationId, error: outcome.error }, `Action execution failed: ${outcome.error}`);
      await this.markAsFailed(`Action execution failed: ${outcome.error}`);
      return false;
    }

    // Apply variable modifications if any
    if (outcome.hasModifiedVars) {
      logger.debug({ conversationId, stageId: this.stageData.id }, `Variables were modified during action execution`);
      const updatedStageVars = { ...this.conversation.stageVars, [this.stageData.id]: context.vars };
      await db.update(conversations)
        .set({ stageVars: updatedStageVars, updatedAt: new Date() })
        .where(and(eq(conversations.projectId, this.conversation.projectId), eq(conversations.id, this.conversation.id)));
      this.conversation.stageVars = updatedStageVars;
    }

    // Apply user profile modifications if any
    if (outcome.hasModifiedUserProfile) {
      logger.debug({ conversationId, userId: this.conversation.userId }, `User profile was modified during action execution`);
      await db.update(users)
        .set({ profile: context.userProfile, updatedAt: new Date() })
        .where(and(eq(users.projectId, this.conversation.projectId), eq(users.id, this.conversation.userId)));
    }

    // Apply stage navigation if specified
    if (outcome.goToStageId && outcome.goToStageId !== this.stageData.id) {
      logger.info({ conversationId, currentStageId: this.stageData.id, targetStageId: outcome.goToStageId }, `Applying stage navigation`);
      await this.goToStage(outcome.goToStageId, true);
    }

    if (outcome.shouldAbortConversation) {
      logger.info({ conversationId }, `Conversation marked for abortion by action execution`);
      await db.update(conversations)
        .set({ status: 'aborted', endingStageId: this.stageData.id, updatedAt: new Date() })
        .where(and(eq(conversations.projectId, this.conversation.projectId), eq(conversations.id, this.conversation.id)));
      return false;
    }

    if (outcome.shouldEndConversation) {
      logger.info({ conversationId }, `Conversation marked for ending by action execution`);
      this.stageData.shouldEndConversation = true; // Flag to indicate conversation should end after current processing completes
      return true;
    }

    logger.debug({ conversationId, hasModifiedVars: outcome.hasModifiedVars, hasModifiedUserInput: outcome.hasModifiedUserInput, hasModifiedUserProfile: outcome.hasModifiedUserProfile, shouldEndConversation: outcome.shouldEndConversation, shouldAbortConversation: outcome.shouldAbortConversation }, `Action outcome applied successfully`);
    return true;
  }

  /**
   * Sets up the inbound audio converter from the client's declared send format to the ASR provider's
   * expected input format. A null converter means the formats match and no conversion is needed.
   * @param asrProvider The initialized ASR provider
   * @param conversationId For log context
   */
  private async setupInboundConverter(asrProvider: IAsrProvider, conversationId: string): Promise<void> {
    const sendFormat: AudioFormat = this.session.sessionSettings.sendAudioFormat ?? 'pcm_16000';
    const asrFormat = asrProvider.getSupportedInputFormats()[0];

    if (sendFormat === asrFormat) {
      logger.debug({ conversationId, sendFormat, asrFormat }, `Inbound audio formats match (${sendFormat}), no converter needed`);
      return;
    }

    logger.info({ conversationId, sendFormat, asrFormat }, `Creating inbound audio converter: ${sendFormat} → ${asrFormat}`);
    this.inboundConverter = await AudioConverterFactory.create(sendFormat, asrFormat);

    this.inboundConverter.on('data', async (chunk: Buffer) => {
      await asrProvider.sendAudio(chunk);
    });

    this.inboundConverter.on('error', async (err: Error) => {
      logger.error({ conversationId, error: err.message }, `Inbound audio converter error for conversation ${conversationId}: ${err.message}`);
      await this.markAsFailed(`Inbound audio converter error: ${err.message}`);
    });
  }

  /**
   * Sets up the outbound audio converter from the TTS provider's native output format to the
   * client's preferred receive format. Applies the last-chunk-buffer pattern so isFinal is
   * correctly propagated even when the converter emits more than one output chunk.
   * A null converter means the formats match and no conversion is needed.
   * @param ttsNativeFormat The format the TTS provider will actually produce
   * @param clientFormat The format the client wants to receive
   * @param conversationId For log context
   */
  private async setupOutboundConverter(ttsNativeFormat: AudioFormat, clientFormat: AudioFormat, conversationId: string): Promise<void> {
    if (ttsNativeFormat === clientFormat) {
      logger.info({ conversationId, ttsNativeFormat, clientFormat }, `Outbound audio formats match (${ttsNativeFormat}), no converter needed`);
      return;
    }

    logger.info({ conversationId, ttsNativeFormat, clientFormat }, `Creating outbound audio converter: ${ttsNativeFormat} → ${clientFormat}`);
    this.outboundConverter = await AudioConverterFactory.create(ttsNativeFormat, clientFormat);

    this.outboundConverter.on('data', async (audioData: Buffer) => {
      // Last-chunk-buffer: send the previously buffered chunk as non-final before buffering the new one
      const pending = this.outboundPendingChunk;
      if (pending) {
        const msg: CALSendAiVoiceChunkMessage = {
          type: 'send_ai_voice_chunk',
          conversationId,
          outputTurnId: this.turnData.outputTurnId,
          audioData: pending.audio,
          audioFormat: clientFormat,
          chunkId: pending.chunkId,
          ordinal: pending.ordinal,
          isFinal: false,
        };
        await this.channel.sendMessage(msg);
        logger.debug({ conversationId, chunkId: pending.chunkId, ordinal: pending.ordinal }, `Outbound converter chunk sent for conversation ${conversationId}`);
      }
      this.outboundPendingChunk = {
        chunkId: generateId(ID_PREFIXES.CHUNK),
        ordinal: this.outboundOrdinalCounter++,
        audio: audioData,
      };
    });

    this.outboundConverter.on('end', async () => {
      // Flush the last buffered chunk with isFinal: true
      if (this.outboundPendingChunk) {
        const msg: CALSendAiVoiceChunkMessage = {
          type: 'send_ai_voice_chunk',
          conversationId,
          outputTurnId: this.turnData.outputTurnId,
          audioData: this.outboundPendingChunk.audio,
          audioFormat: clientFormat,
          chunkId: this.outboundPendingChunk.chunkId,
          ordinal: this.outboundPendingChunk.ordinal,
          isFinal: true,
        };
        await this.channel.sendMessage(msg);
        logger.debug({ conversationId, chunkId: this.outboundPendingChunk.chunkId }, `Final outbound converter chunk sent for conversation ${conversationId}`);
        this.outboundPendingChunk = null;
      }
    });

    this.outboundConverter.on('error', (err: Error) => {
      logger.error({ conversationId, error: err.message }, `Outbound audio converter error for conversation ${conversationId}: ${err.message}`);
    });
  }

  /**
   * Marks the conversation as failed and stores the failure reason
   * @param reason Human-readable description of why the conversation failed
   */
  private async markAsFailed(reason: string): Promise<void> {
    this.conversation.status = 'failed';
    this.conversation.statusDetails = reason;
    await this.conversationService.saveConversationState(this.conversation.projectId, this.conversation.id, 'failed', reason);
    logger.error({ conversationId: this.stageData.conversation.id, reason }, `Conversation ${this.stageData.conversation.id} marked as failed: ${reason}`);

    // Execute __conversation_failed global lifecycle action if defined
    // Errors are swallowed to avoid masking the original failure
    const onConversationFailedAction = this.conversationLifecycleActions.get(CONVERSATION_LIFECYCLE_ACTION_IDS.ON_FAILED);
    if (onConversationFailedAction) {
      try {
        logger.debug({ conversationId: this.conversation.id }, 'Executing __conversation_failed lifecycle action');
        const failedContext = await this.contextBuilder.buildContextForConversationStart(this.conversation);
        const failedOutcome = await this.actionsExecutor.executeActions([onConversationFailedAction], failedContext, 'conversation_failed');
        await this.saveAndSendOutcomeEvents(failedOutcome);
        const actionEventData: ActionEventData = { actionName: onConversationFailedAction.name || '', stageId: this.stageData.id, effects: onConversationFailedAction.effects };
        await this.saveAndSendEvent('action', actionEventData);
      } catch (lifecycleError) {
        logger.error({ conversationId: this.conversation.id, error: lifecycleError instanceof Error ? lifecycleError.message : String(lifecycleError) }, 'Failed to execute __conversation_failed lifecycle action');
      }
    }

    // Save event and send WebSocket message
    const eventData = { reason, stageId: this.stageData.id };
    await this.saveAndSendEvent('conversation_failed', eventData);

    // Update conversation status via ConversationService
    try {
      await this.conversationService.failConversation(this.conversation.projectId, this.stageData.conversation.id, reason);
    } catch (error) {
      logger.error({ conversationId: this.stageData.conversation.id, error: error instanceof Error ? error.message : String(error) }, `Failed to update conversation status in database via ConversationService`);
    }
  }

  /**
   * Processes user input (text or voice) and advances the conversation state
   * @param userInput The user input text to process
   * @param userInputSource Whether the input is text or voice
   * @param asrEndMs Unix timestamp (ms) when ASR recognition completed, if applicable
   */
  /**
   * Resets the response-timing fields of turnData for a new turn, preserving correlation IDs.
   * Called at the start of every entry point that may lead to generateResponse.
   */
  private resetTurnData(): void {
    this.turnMessageVisibility = undefined;
    this.turnData = {
      inputTurnId: this.turnData.inputTurnId,
      outputTurnId: undefined,
      startMs: Date.now(),
      llmStartMs: null,
      firstTokenMs: null,
      firstAudioMs: null,
      assistantMessageEventId: null,
      fillerDurationMs: null,
      moderationDurationMs: null,
      asrStartMs: null,
      ttsStartMs: null,
      turnIndex: this.turnData.turnIndex + 1,
    };
  }

  private async processUserInput(userInput: string, userInputSource: 'text' | 'voice', asrEndMs?: number) {
    this.responseGeneratedInTurn = false;
    // Capture asrStartMs before resetting turnData so we can compute asrDurationMs
    const asrDurationMs = asrEndMs && this.turnData.asrStartMs !== null ? asrEndMs - this.turnData.asrStartMs : null;
    this.resetTurnData();
    const asrDurationMsValue = asrDurationMs && asrDurationMs > 0 ? asrDurationMs : undefined;
    await this.changeState('processing_user_input');

    // Let's save the message event to fill data about timing and user input after moderation and processing
    const preliminaryMessageEventData: MessageEventData = {
      role: 'user',
      text: userInput || '',
      originalText: userInput || '',
      visibility: this.turnMessageVisibility,
      metadata: {
        source: userInputSource,
        inputTurnId: this.turnData.inputTurnId,
        turnIndex: this.turnData.turnIndex,
      }
    };
    const userMessageEventId = await this.saveAndSendEvent('message', preliminaryMessageEventData);

    // Safety: moderation must fully resolve before any LLM call that receives user-derived content.
    // This prevents inappropriate content from reaching provider APIs and risking account bans.
    const moderationResult = await this.moderationService.moderate(userInput, this.stageData.project.moderationConfig, this.conversation.projectId);
    this.turnData.moderationDurationMs = moderationResult.durationMs > 0 ? moderationResult.durationMs : null;
    if (moderationResult.detectedCategories.length > 0) {
      const moderationEventData: ModerationEventData = { input: userInput, flagged: moderationResult.flagged, blockingCategories: moderationResult.blockingCategories, detectedCategories: moderationResult.detectedCategories, durationMs: moderationResult.durationMs };
      await this.saveAndSendEvent('moderation', moderationEventData);
    }
    if (moderationResult.flagged) {
      logger.warn({ conversationId: this.conversation.id, categories: moderationResult.blockingCategories }, 'User input blocked by content moderation');

      // Execute __moderation_blocked global action if configured, otherwise abort silently
      logger.info({ globalActions: this.stageData.globalActions }, 'Checking for __moderation_blocked global action');
      const moderationBlockedAction = this.stageData.globalActions.find(ga => ga.id === '__moderation_blocked');
      if (moderationBlockedAction) {
        const context = await this.contextBuilder.buildContextForUserInput(this.stageData.conversation, this.stageData.stage, [], userInput, userInputSource, this.stageData.faq);
        const executionOutcome = await this.actionsExecutor.executeActions([moderationBlockedAction], context);
        await this.applyActionOutcome(context, executionOutcome);
        const messageEventData: MessageEventData = {
          text: '[Content removed by moderation]',
          originalText: userInput,
          role: 'user',
          visibility: this.turnMessageVisibility,
          metadata: { moderationDurationMs: this.turnData.moderationDurationMs }
        };
        await this.saveAndSendEvent('message', messageEventData);
        await this.saveAndSendOutcomeEvents(executionOutcome);
        const actionEventData: ActionEventData = { actionName: moderationBlockedAction.name || '', stageId: this.stageData.id, effects: moderationBlockedAction.effects };
        await this.saveAndSendEvent('action', actionEventData);
        await this.generateResponse(context, executionOutcome);
        return;
      }
      // No moderation block action defined - carry on
      userInput = '[Content removed by moderation]';
    }

    // Start filler sentence immediately — opens the response turn early by sending
    // start_ai_generation_output and feeding the sentence into TTS before classification begins.
    this.lastFillerSentence = null;
    this.lastFillerPrompt = null;
    const fillerStartMs = Date.now();
    const fillerSentence = await this.generateFillerSentence(userInput);
    if (fillerSentence) {
      this.turnData.fillerDurationMs = Date.now() - fillerStartMs;
      this.turnData.outputTurnId = generateId(ID_PREFIXES.OUTPUT);
      const fillerStartMessage: CALStartAiGenerationOutputMessage = {
        type: 'start_ai_generation_output',
        conversationId: this.conversation.id,
        outputTurnId: this.turnData.outputTurnId,
        expectVoice: !!this.stageData.ttsProvider,
      };
      await this.channel.sendMessage(fillerStartMessage);
      if (this.stageData.ttsProvider) {
        await this.stageData.ttsProvider.start();
        await this.stageData.ttsProvider.sendText(fillerSentence);
      }
      const fillerChunkMessage: CALAiTranscribedChunkMessage = {
        type: 'ai_transcribed_chunk',
        conversationId: this.conversation.id,
        outputTurnId: this.turnData.outputTurnId,
        chunkId: generateId(ID_PREFIXES.CHUNK),
        chunkText: fillerSentence,
        ordinal: 0,
        isFinal: true,
      };
      await this.channel.sendMessage(fillerChunkMessage);
      this.responseOutputTurnStarted = true;
      this.lastFillerSentence = fillerSentence;
    }

    const processingStartMs = Date.now();
    const processingResult = await this.userInputProcessor.processTextInput(this.session, userInput, userInput);
    const processingDurationMs = Date.now() - processingStartMs;
    const classificationResults = processingResult.actions;
    const knowledgeRetrievalDurationMs = processingResult.knowledgeRetrievalDurationMs;

    // Detect and handle knowledge actions - these are synthetic actions from the knowledge base
    const knowledgeResults = classificationResults.filter(r => r.name.startsWith('__knowledge_'));
    const nonKnowledgeResults = classificationResults.filter(r => !r.name.startsWith('__knowledge_'));

    if (knowledgeResults.length > 0) {
      const categoryIds = knowledgeResults.map(r => r.name.slice('__knowledge_'.length));
      const itemArrays = await Promise.all(categoryIds.map(id => this.knowledgeService.getItemsByCategory(this.conversation.projectId, id)));
      this.stageData.faq = itemArrays.flat().map(item => ({ question: item.question, answer: item.answer }));
      logger.debug({ conversationId: this.conversation.id, categoryCount: categoryIds.length, itemCount: this.stageData.faq.length }, 'Updated FAQ from knowledge actions');
    }

    // Filter out lifecycle actions from classification matching
    const lifecycleActionNames = Object.values(LIFECYCLE_ACTION_NAMES) as string[];
    const stageActions = Object.fromEntries(
      Object.entries(this.stageData.stage.actions)
        .filter(([name]) => !lifecycleActionNames.includes(name))
    );
    const globalActionsMap = new Map(this.stageData.globalActions.map(ga => [ga.name, ga]));
    const guardrailActionsMap = new Map(this.stageData.guardrails.map(ga => [ga.name, ga]));
    const context = await this.contextBuilder.buildContextForUserInput(this.stageData.conversation, this.stageData.stage, nonKnowledgeResults, userInput, userInputSource, this.stageData.faq);
    const stageActionMap = new Map(Object.values(stageActions).map(sa => [sa.name, sa]));

    // Deduplicate actions by name - if multiple classifiers detect the same action, only include it once
    const seenActionNames = new Set<string>();
    const actions = nonKnowledgeResults.map(r => {
      // Skip if we've already processed this action
      if (seenActionNames.has(r.name)) {
        logger.debug({ conversationId: this.conversation.id, actionName: r.name }, `Skipping duplicate action ${r.name} detected by multiple classifiers`);
        return null;
      }
      seenActionNames.add(r.name);

      // First check stage actions
      const stageAction = stageActionMap.get(r.name);
      if (stageAction) {
        // inject action with parameters into context
        context.actions[stageAction.name] = {
          parameters: r.parameters,
        };
        return stageAction;
      }

      // Then check global actions
      const globalAction = globalActionsMap.get(r.name);
      if (globalAction) {
        // inject action with parameters into context
        context.actions[globalAction.name] = {
          parameters: r.parameters,
        };
        return globalAction;
      }

      const guardrailAction = guardrailActionsMap.get(r.name);
      if (guardrailAction) {
        // inject action with parameters into context
        context.actions[guardrailAction.name] = {
          parameters: r.parameters,
        };
        return guardrailAction;
      }

      logger.warn({ conversationId: this.conversation.id, actionName: r.name }, `No matching action found for classification result ${r.name}`);
      return null;
    }).filter(a => a !== null) as (StageAction | GlobalAction | Guardrail)[];

    // If no actions matched and __on_fallback is defined, execute it
    let executionOutcome: ActionsExecutionOutcome;
    let actionsDurationMs: number;
    const onFallbackAction = this.stageData.stage.actions[LIFECYCLE_ACTION_NAMES.ON_FALLBACK];
    if (actions.length === 0 && onFallbackAction) {
      logger.debug({ conversationId: this.conversation.id }, 'No actions matched - executing __on_fallback lifecycle action');
      const actionsStartMs = Date.now();
      executionOutcome = await this.actionsExecutor.executeActions([onFallbackAction], context, 'on_fallback');
      actionsDurationMs = Date.now() - actionsStartMs;
      await this.applyActionOutcome(context, executionOutcome);

      // Save/send tool call events from action execution
      await this.saveAndSendOutcomeEvents(executionOutcome);

      // Register action event for __on_fallback
      const actionEventData: ActionEventData = {
        actionName: onFallbackAction.name || '',
        stageId: this.stageData.id,
        effects: onFallbackAction.effects,
      };
      await this.saveAndSendEvent('action', actionEventData);
    } else {
      const actionsStartMs = Date.now();
      executionOutcome = await this.actionsExecutor.executeActions(actions, context);
      actionsDurationMs = Date.now() - actionsStartMs;
      await this.applyActionOutcome(context, executionOutcome);

      // Save/send tool call events from action execution
      await this.saveAndSendOutcomeEvents(executionOutcome);
    }

    // Register action events after execution
    for (const action of actions) {
      const actionEventData: ActionEventData = {
        actionName: action.name || '',
        stageId: this.stageData.id,
        effects: action.effects,
      };
      await this.saveAndSendEvent('action', actionEventData);
    }

    if (executionOutcome.turnVisibility) {
      this.turnMessageVisibility = executionOutcome.turnVisibility;
    }

    // Update message event with moderation and processing results, which may be needed for response generation and should be sent to client for UI updates
    const updated = await this.conversationService.updateMessageEvent(this.conversation.projectId, userMessageEventId, context.userInput, {
        source: context.userInputSource,
        inputTurnId: this.turnData.inputTurnId,
        turnIndex: this.turnData.turnIndex,
        asrDurationMs: asrDurationMsValue,
        moderationDurationMs: this.turnData.moderationDurationMs ?? undefined,
        processingDurationMs,
        knowledgeRetrievalDurationMs,
        actionsDurationMs,
        fillerDurationMs: this.turnData.fillerDurationMs,
    }, this.turnMessageVisibility);
    const messageUpdateMessage: CALConversationEventUpdateMessage = {
      type: 'conversation_event_update',
      conversationId: this.conversation.id,
      eventType: 'message',
      eventData: updated.eventData,
      inputTurnId: this.turnData.inputTurnId,
      outputTurnId: this.turnData.outputTurnId,
    };
    await this.channel.sendMessage(messageUpdateMessage);

    await this.generateResponse(context, executionOutcome);
  }

  private async generateResponse(context: ConversationContext, executionOutcome: ActionsExecutionOutcome) {
    const shouldGenerateResponse = executionOutcome.success && !executionOutcome.shouldAbortConversation && executionOutcome.shouldGenerateResponse;
    if (shouldGenerateResponse) {
      if (this.responseGeneratedInTurn) {
        logger.warn({ conversationId: this.conversation.id }, 'Response already generated/scheduled for this turn — skipping duplicate response generation');
        return;
      }
      this.responseGeneratedInTurn = true;

      if (this.responseOutputTurnStarted) {
        // Filler already opened the turn: outputTurnId, start_ai_generation_output and TTS start
        // were handled in processUserInput — skip all of that here.
        this.responseOutputTurnStarted = false;
      } else {
        // Normal path: open the turn now.
        this.turnData.outputTurnId = generateId(ID_PREFIXES.OUTPUT);
        const startGenerationMessage: CALStartAiGenerationOutputMessage = {
          type: 'start_ai_generation_output',
          conversationId: this.conversation.id,
          outputTurnId: this.turnData.outputTurnId,
          expectVoice: this.stageData.ttsProvider !== undefined && this.stageData.ttsProvider !== null,
        };
        await this.channel.sendMessage(startGenerationMessage);

        if (this.stageData.ttsProvider) {
          await this.stageData.ttsProvider.start();
        }
      }
      await this.changeState('generating_response');
      if (executionOutcome.prescriptedResponse !== undefined) {
        await this.deliverPrescriptedResponse(executionOutcome.prescriptedResponse);
      } else {
        this.stageData.lastCompletionPrompt = await this.templatingEngine.render(this.stageData.stage.prompt, context);
        this.turnData.firstTokenMs = null;
        this.turnData.llmStartMs = Date.now();
        await this.responseGenerator.generateResponse(context, this.stageData.stage, this.stageData.lastCompletionPrompt, this.stageData.completionLlmProvider, this.lastFillerSentence ?? undefined);
      }
      this.lastFillerSentence = null;
      this.lastFillerPrompt = null;

      if (executionOutcome.shouldEndConversation) {
        // Execute __conversation_end global lifecycle action if defined
        const onConversationEndAction = this.conversationLifecycleActions.get(CONVERSATION_LIFECYCLE_ACTION_IDS.ON_END);
        if (onConversationEndAction) {
          logger.debug({ conversationId: this.conversation.id }, 'Executing __conversation_end lifecycle action');
          const endLifecycleOutcome = await this.actionsExecutor.executeActions([onConversationEndAction], context, 'conversation_end');
          await this.applyActionOutcome(context, endLifecycleOutcome);
          await this.saveAndSendOutcomeEvents(endLifecycleOutcome);
          const actionEventData: ActionEventData = { actionName: onConversationEndAction.name || '', stageId: this.stageData.id, effects: onConversationEndAction.effects };
          await this.saveAndSendEvent('action', actionEventData);
        }

        const eventData: ConversationEndEventData = {
          stageId: this.stageData.id,
          reason: executionOutcome.endReason || 'Action execution completed conversation',
        };
        await this.saveAndSendEvent('conversation_end', eventData);
        await this.changeTerminalState('finished');
      }
    } else if (executionOutcome.shouldAbortConversation) {
      // Close the filler turn if it was opened but no response follows
      if (this.responseOutputTurnStarted) {
        this.responseOutputTurnStarted = false;
        if (this.stageData.ttsProvider) {
          await this.stageData.ttsProvider.end();
        }
      }
      // Execute __conversation_abort global lifecycle action if defined
      const onConversationAbortAction = this.conversationLifecycleActions.get(CONVERSATION_LIFECYCLE_ACTION_IDS.ON_ABORT);
      if (onConversationAbortAction) {
        logger.debug({ conversationId: this.conversation.id }, 'Executing __conversation_abort lifecycle action');
        const abortLifecycleOutcome = await this.actionsExecutor.executeActions([onConversationAbortAction], context, 'conversation_abort');
        await this.applyActionOutcome(context, abortLifecycleOutcome);
        await this.saveAndSendOutcomeEvents(abortLifecycleOutcome);
        const actionEventData: ActionEventData = { actionName: onConversationAbortAction.name || '', stageId: this.stageData.id, effects: onConversationAbortAction.effects };
        await this.saveAndSendEvent('action', actionEventData);
      }
      // Abort conversation without generating response
      const eventData: ConversationAbortedEventData = {
        stageId: this.stageData.id,
        reason: executionOutcome.abortReason || 'Conversation aborted by action',
      };
      await this.saveAndSendEvent('conversation_aborted', eventData);
      await this.changeTerminalState('finished');
    } else {
      // Close the filler turn if it was opened but no response follows
      if (this.responseOutputTurnStarted) {
        this.responseOutputTurnStarted = false;
        if (this.stageData.ttsProvider) {
          await this.stageData.ttsProvider.end();
        }
      }
      // If no response generation, go back to awaiting user input
      await this.changeState('awaiting_user_input');
    }
  }

  /**
   * Calls the filler LLM provider to generate a short neutral sentence for the current turn.
   * The filler prompt is processed through the templating engine before being sent to the LLM.
   * @returns A generated filler sentence, or null if filler is not configured or generation fails.
   */
  private async generateFillerSentence(userInput: string): Promise<string | null> {
    const fillerLlmProvider = this.stageData.fillerLlmProvider;
    const fillerSettings = this.stageData.agent?.fillerSettings;
    if (!fillerLlmProvider || !fillerSettings) {
      return null;
    }
    try {
      const context = await this.contextBuilder.buildContextForFillerSentence(this.conversation, this.stageData.stage, userInput);
      const renderedPrompt = await this.templatingEngine.render(fillerSettings.prompt, context);
      const result = await fillerLlmProvider.generate([
        { role: 'system', content: renderedPrompt },
        { role: 'user', content: userInput }]);
      const text = extractTextFromContent(result.content).trim();
      if (text.length > 0) {
        this.lastFillerPrompt = renderedPrompt;
        return text;
      }
      return null;
    } catch (error) {
      logger.warn({ conversationId: this.conversation.id, message: error?.message }, 'Failed to generate filler sentence, skipping');
      return null;
    }
  }

  /**
   * Delivers a prescripted response text directly to the client and TTS pipeline,
   * bypassing LLM generation. Mirrors the chunk + complete callback flow used by
   * the completion LLM provider so that TTS, WebSocket messages, and conversation
   * events are handled identically to AI-generated responses.
   * @param text - The prescripted response text to deliver
   */
  private async deliverPrescriptedResponse(text: string): Promise<void> {
    const conversationId = this.conversation.id;
    const ttsProvider = this.stageData.ttsProvider;

    logger.info({ conversationId, responseLength: text.length }, `Delivering prescripted response for conversation ${conversationId}`);

    if (ttsProvider) {
      await ttsProvider.sendText(text);
    }

    const prescriptedChunkMessage: CALAiTranscribedChunkMessage = {
      type: 'ai_transcribed_chunk',
      conversationId,
      outputTurnId: this.turnData.outputTurnId,
      chunkId: generateId(ID_PREFIXES.CHUNK),
      chunkText: text,
      ordinal: 0,
      isFinal: true,
    };
    await this.channel.sendMessage(prescriptedChunkMessage);

    const messageEventData: MessageEventData = {
      text,
      role: 'assistant',
      originalText: text,
      visibility: this.turnMessageVisibility,
      metadata: {
        prescripted: true,
      },
    };
    await this.saveAndSendEvent('message', messageEventData);

    if (!ttsProvider) {
      const prescriptedEndMessage: CALEndAiGenerationOutputMessage = {
        type: 'end_ai_generation_output',
        conversationId,
        outputTurnId: this.turnData.outputTurnId,
        fullText: text,
      };
      await this.channel.sendMessage(prescriptedEndMessage);
      await this.changeState('awaiting_user_input');
    } else {
      await ttsProvider.end();
    }
  }

  /**
   * Gets the current state of the conversation
   */
  getState(): ConversationState {
    return this.conversation.status;
  }

  /**
   * Gets the failure reason if the conversation has failed
   */
  getFailureReason(): string | undefined {
    return this.conversation.statusDetails;
  }

  private async changeState(newState: ConversationState) {
    this.conversation.status = newState;
    await this.conversationService.saveConversationState(this.conversation.projectId, this.conversation.id, newState);
  }

  /**
   * Transitions the conversation to a terminal state and records the stage at which it ended.
   * @param newState - The terminal state to transition to
   */
  private async changeTerminalState(newState: ConversationState): Promise<void> {
    this.conversation.status = newState;
    await this.conversationService.saveConversationState(this.conversation.projectId, this.conversation.id, newState, undefined, undefined, this.stageData.id);
  }

  /**
   * Helper method to save a conversation event and send it to connected clients via WebSocket.
   * @returns The generated event ID
   */
  private async saveAndSendEvent(eventType: any, eventData: any): Promise<string> {
    const inputTurnId = this.turnData.inputTurnId;
    const outputTurnId = this.turnData.outputTurnId;
    if (!eventData.metadata) {
      eventData.metadata = {};
    }
    eventData.metadata['currentVariables'] = this.conversation.stageVars?.[this.stageData.id] || {};

    const eventId = await this.conversationService.saveConversationEvent(this.conversation.projectId, this.conversation.id, eventType, eventData);
    const eventMessage: CALConversationEventMessage = {
      type: 'conversation_event',
      conversationId: this.conversation.id,
      eventType,
      eventData,
      inputTurnId,
      outputTurnId,
    };
    await this.channel.sendMessage(eventMessage);
    return eventId;
  }

  /**
   * Helper method to save/send tool events from action execution outcomes
   */
  private async saveAndSendOutcomeEvents(outcome: ActionsExecutionOutcome): Promise<void> {
    if (outcome.toolCallEvents && outcome.toolCallEvents.length > 0) {
      for (const toolCallEvent of outcome.toolCallEvents) {
        const eventData = {
          toolId: toolCallEvent.toolId,
          toolName: toolCallEvent.toolName,
          toolType: toolCallEvent.toolType,
          parameters: toolCallEvent.parameters,
          success: toolCallEvent.success,
          result: toolCallEvent.result,
          error: toolCallEvent.error,
          metadata: {
            systemPrompt: toolCallEvent.systemPrompt,
            llmSettings: toolCallEvent.llmSettings,
            durationMs: toolCallEvent.durationMs,
          }
        };
        await this.saveAndSendEvent('tool_call', eventData);
      }
    }
  }
}
