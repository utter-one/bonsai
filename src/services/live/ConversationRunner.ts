import { z } from "zod";
import { inject, injectable } from "tsyringe";
import { NotFoundError, InvalidOperationError } from "../../errors";
import { Classifier, ContextTransformer, Conversation, GlobalAction, Guardrail, Project, SampleCopy, Stage, Tool } from "../../types/models";
import { StageAction, LIFECYCLE_ACTION_NAMES, CONVERSATION_LIFECYCLE_ACTION_IDS } from "../../types/actions";
import type { LifecycleContext } from "../../types/actions";
import { db } from "../../db";
import { conversations, users, sampleCopies } from "../../db/schema";
import { MessageEventData, CommandEventData, CommandType, ConversationStartEventData, ConversationResumeEventData, ConversationEndEventData, ConversationAbortedEventData, ConversationFailedEventData, JumpToStageEventData, ToolCallEventData, ModerationEventData, conversationStateSchema, ConversationState, MessageVisibility, VariablesUpdatedEventData, TurnAbortedEventData } from "../../types/conversationEvents";
import { ConversationService } from "../ConversationService";
import { ConversationStorageService } from "../ConversationStorageService";
import { ConversationRecorder } from "./ConversationRecorder";
import { logger } from "../../utils/logger";
import { AgentService } from "../AgentService";
import type { Session } from "../../channels/SessionManager";
import type { IClientConnection } from '../../channels/IClientConnection';
import type { CALUserTranscribedChunkMessage, CALAiTranscribedChunkMessage, CALStartAiGenerationOutputMessage, CALSendAiVoiceChunkMessage, CALEndAiGenerationOutputMessage, CALConversationEventMessage, CALConversationEventUpdateMessage, CALAbortAiGenerationOutputMessage, CALUserSpeakingStartedMessage } from '../../channels/messages';
import { ILlmProvider, LlmChunk, LlmGenerationResult, LlmMessage } from "../providers/llm/ILlmProvider";
import { buildLlmUsage, LlmProviderInfo, LlmUsageMetadata } from '../../utils/llmUsage';
import { IAsrProvider } from "../providers/asr/IAsrProvider";
import { ITtsProvider } from "../providers/tts/ITtsProvider";
import { LlmProviderFactory } from "../providers/llm/LlmProviderFactory";
import { AsrProviderFactory } from "../providers/asr/AsrProviderFactory";
import { TtsProviderFactory } from "../providers/tts/TtsProviderFactory";
import { UserInputProcessor } from "./UserInputProcessor";
import { TtsSettings } from "../providers/tts/TtsProviderFactory";
import { ActionsExecutionOutcome, ActionsExecutor, EffectEventCallback } from "./ActionsExecutor";
import { ConversationContext, ConversationContextBuilder } from "./ConversationContextBuilder";
import { and, eq, notInArray } from "drizzle-orm";
import { ResponseGenerator } from "./ResponseGenerator";
import { ToolExecutor } from "./ToolExecutor";
import { generateId, ID_PREFIXES } from "../../utils/idGenerator";

import { TemplatingEngine } from "./TemplatingEngine";
import { extractTextFromContent, getContentSize } from "../../utils/llm";
import { KnowledgeService } from "../KnowledgeService";
import { ModerationService } from "../ModerationService";
import type { ModerationResult } from "../ModerationService";
import type { FaqItem } from "./ConversationContextBuilder";
import type { AgentResponse } from "../../http/contracts/agent";
import type { CostManagementConfig } from "../../http/contracts/costManagement";
import { resolveProviderModelLimits, resolveOutputCap } from "../../utils/costManagement";
import { truncateMessagesToTokenBudget, type TruncationInfo } from "../../utils/contextTruncation";
import type { IAudioConverter } from '../audio/IAudioConverter';
import type { AudioFormat } from '../../types/audio';
import { AudioConverterFactory } from '../audio/AudioConverterFactory';
import { VadProcessor } from '../audio/VadProcessor';
import smartTurnDetector from '../audio/SmartTurnDetector';
import type { ServerVadConfig } from '../../http/contracts/vad';
import { SampleCopyDistributor } from "./SampleCopyDistributor";


/** Buffer holding the last converted audio chunk, used by the last-chunk-buffer pattern. */
type PendingOutboundChunk = { chunkId: string; ordinal: number; audio: Buffer };

export type ClassifierRuntimeData = {
  classifier: Classifier;
  llmProvider: ILlmProvider;
  llmProviderInfo: LlmProviderInfo;
}

export type TransformerRuntimeData = {
  transformer: ContextTransformer;
  llmProvider: ILlmProvider;
  llmProviderInfo: LlmProviderInfo;
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
  /** Unix timestamp (ms) when prompt template rendering started */
  promptRenderStartMs: number | null;
  /** Unix timestamp (ms) when prompt template rendering completed */
  promptRenderEndMs: number | null;
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
  /** Token usage from the filler LLM call; null when no filler was generated */
  fillerLlmUsage: LlmUsageMetadata | null;
  /** Duration of the moderation API call in milliseconds; null when moderation was not performed */
  moderationDurationMs: number | null;
  /** Unix timestamp (ms) when the moderation API call started; null when moderation was not performed */
  moderationStartMs: number | null;
  /** Unix timestamp (ms) when the moderation API call completed; null when moderation was not performed */
  moderationEndMs: number | null;
  /** Unix timestamp (ms) when ASR recognition started */
  asrStartMs: number | null;
  /** Unix timestamp (ms) when a stage transition (goToStage) was initiated by an action outcome */
  stageTransitionStartMs: number | null;
  /** Unix timestamp (ms) when the stage transition completed (stage data reloaded, providers re-wired, on_enter executed) */
  stageTransitionEndMs: number | null;
  /** Unix timestamp (ms) when the TTS WebSocket connection was initiated */
  ttsConnectStartMs: number | null;
  /** Unix timestamp (ms) when the TTS WebSocket connection was established and ready */
  ttsConnectEndMs: number | null;
  /** Unix timestamp (ms) when the TTS provider started synthesising the first chunk */
  ttsStartMs: number | null;
  /** Sequential 1-based turn number within the conversation */
  turnIndex: number;
  /** Filler sentence text delivered to the client and TTS at the start of the current turn; null when no filler was generated */
  fillerSentence: string | null;
  /** Prescripted response text (sample copy in forced mode) delivered in the current turn; null for LLM-generated responses */
  prescriptedText: string | null;
  /** Truncation info from the completion context window preparation; null before first completion in the turn */
  completionTruncationInfo: TruncationInfo | null;
  /** Accumulated LLM output text for the current turn; used to populate accumulatedText on barge-in abort */
  accumulatedText: string | null;
};

export type StageRuntimeData = {
  id: string;
  conversation: Conversation;
  project: Project;
  stage: Stage;
  completionLlmProvider?: ILlmProvider;
  completionLlmProviderInfo?: LlmProviderInfo;
  lastCompletionResult: LlmGenerationResult | null;
  lastCompletionPrompt?: string;
  classifiers: ClassifierRuntimeData[];
  transformers: TransformerRuntimeData[];
  globalActions: GlobalAction[];
  guardrails: Guardrail[];
  guardrailClassifier?: ClassifierRuntimeData;
  sampleCopies: SampleCopy[];
  sampleCopyClassifier?: ClassifierRuntimeData;
  asrProvider?: IAsrProvider;
  ttsProvider?: ITtsProvider;
  shouldEndConversation: boolean;
  agent: AgentResponse | null;
  fillerLlmProvider?: ILlmProvider;
  fillerLlmProviderInfo?: LlmProviderInfo;
  moderationProvider?: ILlmProvider;
  faq: FaqItem[];
  costManagementConfig: CostManagementConfig | null;
}

/**
 * Deferred terminal action to execute after response delivery (including TTS audio) is complete.
 * Used to ensure end/abort lifecycle events are sent only after the client has received all audio.
 */
type PendingPostResponseAction =
  | { name: string, type: 'end_conversation'; endReason: string; context: ConversationContext }
  | { name: string, type: 'abort_conversation'; abortReason: string; context: ConversationContext };

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
  /** True when TTS was actually used to speak audio during the current turn. */
  private ttsUsedInTurn: boolean = false;
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
  /** Terminal action (end or abort) deferred until after the current turn's response has been fully delivered to the client */
  private pendingPostResponseAction: PendingPostResponseAction | null = null;
  /** Sample copy distributor */
  private sampleCopyDistributor: SampleCopyDistributor | null = null;
  /** Session-scoped inbound converter: client audio format → ASR input format. Null when no conversion is needed. */
  private inboundConverter: IAudioConverter | null = null;
  /** Session-scoped outbound converter: TTS native format → client preferred format. Null when no conversion is needed. */
  private outboundConverter: IAudioConverter | null = null;
  /** Sequential ordinal for outbound converted chunks; reset at the start of each TTS turn. */
  private outboundOrdinalCounter = 0;
  /** Last-chunk buffer for the outbound converter pathway; ensures isFinal is only applied to the terminal chunk. */
  private outboundPendingChunk: PendingOutboundChunk | null = null;
  /** Server-side VAD processor; non-null when the project is configured with serverVad and the ASR format is PCM. */
  private vadProcessor: VadProcessor | null = null;
  /**
      * Tracks an in-flight pre-warm of the ASR session. Set when transitioning to awaiting_user_input
      * in VAD mode so the next turn does not pay the full ASR connection cost. Null when no pre-warm
      * is in progress or after it has been consumed by handleVadSpeechStart.
      */
  private asrPreWarmPromise: Promise<void> | null = null;
  /** Buffered utterance audio for Smart Turn endpoint detection. Set on 'utterance_audio' VAD event. */
  private smartTurnAudioBuffer: Float32Array | null = null;
  /** Timer that stops ASR if Smart Turn indicates continuation but no new speech arrives. */
  private smartTurnContinueTimer: NodeJS.Timeout | null = null;
  /** Duration before Smart Turn continuation times out and ASR is stopped. */
  private readonly SMART_TURN_CONTINUE_TIMEOUT_MS = 3000;

  /** Partial ASR transcript accumulated during barge-in (silent barge-in captures partial text). Null when not in barge-in mode. */
  private bargeInPartialText: string | null = null;
  /** True when a user barge-in has been detected and we are accumulating continued speech. */
  private isBargeIn = false;


  /** Timer that fires when the user is silent in awaiting_user_input state. */
  private silenceTimer: NodeJS.Timeout | null = null;
  /** Counter of consecutive silence-triggered responses. Reset on real user input. */
  private silenceCount: number = 0;
  /** True when the runner is waiting for the client to signal that AI audio playback has completed. */
  private waitingForPlaybackEnd: boolean = false;
  /** Timer that fires when the user is silent in barge-in mode. */
  private bargeInSilenceTimer: NodeJS.Timeout | null = null;

  /** Handles audio recording for the conversation. */
  private recorder: ConversationRecorder | null = null;

  /** True when server-side VAD is active for this session. VAD owns the turn lifecycle when active. */
  get isVadMode(): boolean {
    return this.vadProcessor !== null;
  }

  /** Per-turn runtime data: correlation IDs, timing markers, and event tracking for the active input/output turn */
  private turnData: TurnData = { startMs: null, promptRenderStartMs: null, promptRenderEndMs: null, llmStartMs: null, firstTokenMs: null, firstAudioMs: null, assistantMessageEventId: null, fillerDurationMs: null, fillerLlmUsage: null, moderationDurationMs: null, moderationStartMs: null, moderationEndMs: null, asrStartMs: null, stageTransitionStartMs: null, stageTransitionEndMs: null, ttsConnectStartMs: null, ttsConnectEndMs: null, ttsStartMs: null, turnIndex: 0, fillerSentence: null, prescriptedText: null, completionTruncationInfo: null, accumulatedText: null };

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
    @inject(ConversationStorageService) private conversationStorageService: ConversationStorageService,
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
      throw new InvalidOperationError(`Conversation with ID ${conversationId} is not active`);
    }

    // Load sample copy data
    const allSampleCopies = await db.query.sampleCopies.findMany({
      where: (sampleCopies, { eq }) => eq(sampleCopies.projectId, session.projectId),
    });
    this.sampleCopyDistributor = new SampleCopyDistributor(allSampleCopies);


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
      completionLlmProviderInfo: undefined,
      lastCompletionResult: null,
      classifiers: [],
      transformers: [],
      globalActions: [],
      guardrails: [],
      guardrailClassifier: undefined,
      sampleCopies: [],
      sampleCopyClassifier: undefined,
      asrProvider: undefined,
      ttsProvider: undefined,
      moderationProvider: undefined,
      shouldEndConversation: false,
      agent: null,
      faq: [],
      costManagementConfig: project?.costManagementConfig ?? null,
    };

    // Load completion LLM provider for the stage
    if (stage.llmProviderId) {
      const llmProviderEntity = await db.query.providers.findFirst({ where: (providers, { eq }) => eq(providers.id, stage.llmProviderId) });
      if (llmProviderEntity) {
        stageData.completionLlmProvider = await this.llmProviderFactory.createProvider(llmProviderEntity, stage.llmSettings);
        stageData.completionLlmProviderInfo = { id: llmProviderEntity.id, apiType: llmProviderEntity.apiType };
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
      if (!llmProviderEntity) {
        throw new NotFoundError(`LLM Provider with ID ${classifier.llmProviderId} not found for classifier ${classifierId}`);
      }
      const llmProvider = await this.llmProviderFactory.createProvider(llmProviderEntity, classifier.llmSettings);
      stageData.classifiers.push({ classifier, llmProvider, llmProviderInfo: { id: llmProviderEntity.id, apiType: llmProviderEntity.apiType } });
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
      if (!llmProviderEntity) {
        throw new NotFoundError(`LLM Provider with ID ${transformer.llmProviderId} not found for transformer ${transformerId}`);
      }
      const llmProvider = await this.llmProviderFactory.createProvider(llmProviderEntity, transformer.llmSettings);
      stageData.transformers.push({ transformer, llmProvider, llmProviderInfo: { id: llmProviderEntity.id, apiType: llmProviderEntity.apiType } });
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
        if (!guardrailLlmProviderEntity) {
          throw new NotFoundError(`LLM Provider with ID ${guardrailClassifierEntity.llmProviderId} not found for guardrail classifier ${guardrailClassifierEntity.id}`);
        }
        stageData.guardrailClassifier = {
          classifier: guardrailClassifierEntity,
          llmProvider: await this.llmProviderFactory.createProvider(guardrailLlmProviderEntity, guardrailClassifierEntity.llmSettings),
          llmProviderInfo: { id: guardrailLlmProviderEntity.id, apiType: guardrailLlmProviderEntity.apiType },
        };
      } else {
        logger.warn({ projectId: project.id, classifierId: project.defaultGuardrailClassifierId }, 'Guardrail classifier not found, guardrails will be skipped');
      }
    }

    // Load sample copies and sampleCopyClassifier if {{copy}} tag is used in the stage prompt
    const hasCopyTag = stage.prompt.includes('{{copy}}') || stage.prompt.includes('{{copy.');
    if (hasCopyTag) {
      const allProjectSampleCopies = await db.query.sampleCopies.findMany({
        where: (sc, { eq }) => eq(sc.projectId, conversation.projectId),
      });
      // Include copies scoped to this stage and agent (or null/empty stages/agents array)
      stageData.sampleCopies = allProjectSampleCopies.filter(copy =>
        (!copy.stages || (copy.stages as string[]).length === 0 || (copy.stages as string[]).includes(stage.id))
        && (copy.agents === null || (copy.agents as string[]).length === 0 || (copy.agents as string[]).includes(stage.agentId))
      );

      const sampleCopyClassifierId = project.sampleCopyConfig?.defaultClassifierId;
      if (sampleCopyClassifierId) {
        const sampleCopyClassifierEntity = await db.query.classifiers.findFirst({
          where: (classifiers, { and, eq }) => and(eq(classifiers.projectId, conversation.projectId), eq(classifiers.id, sampleCopyClassifierId)),
        });
        if (sampleCopyClassifierEntity) {
          const sampleCopyLlmProviderEntity = await db.query.providers.findFirst({ where: (providers, { eq }) => eq(providers.id, sampleCopyClassifierEntity.llmProviderId) });
          if (!sampleCopyLlmProviderEntity) {
            throw new NotFoundError(`LLM Provider with ID ${sampleCopyClassifierEntity.llmProviderId} not found for sample copy classifier ${sampleCopyClassifierEntity.id}`);
          }
          stageData.sampleCopyClassifier = {
            classifier: sampleCopyClassifierEntity,
            llmProvider: await this.llmProviderFactory.createProvider(sampleCopyLlmProviderEntity, sampleCopyClassifierEntity.llmSettings),
            llmProviderInfo: { id: sampleCopyLlmProviderEntity.id, apiType: sampleCopyLlmProviderEntity.apiType },
          };
        } else {
          logger.warn({ projectId: project.id, classifierId: sampleCopyClassifierId }, 'Sample copy classifier not found, sample copy classification will be skipped');
        }
      } else {
        logger.warn({ projectId: project.id }, 'No default sample copy classifier configured, sample copy classification will be skipped');
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
        stageData.fillerLlmProvider = await this.llmProviderFactory.createProvider(fillerLlmProviderEntity, agent.fillerSettings.llmSettings);
        stageData.fillerLlmProviderInfo = { id: fillerLlmProviderEntity.id, apiType: fillerLlmProviderEntity.apiType };
      } else {
        logger.warn({ agentId: agent.id, llmProviderId: agent.fillerSettings.llmProviderId }, 'Filler LLM provider not found, filler responses will be skipped');
      }
    }

    const ttsSettings = agent.ttsSettings;
    if (project.generateVoice && agent.ttsProviderId && this.session.sessionSettings.receiveVoiceOutput) {
      const voiceProviderEntity = await db.query.providers.findFirst({ where: (providers, { eq }) => eq(providers.id, agent.ttsProviderId) });
      if (voiceProviderEntity && ttsSettings) {
        stageData.ttsProvider = await this.ttsProviderFactory.createProvider(voiceProviderEntity, ttsSettings);
      }
    }

    // Initialize ASR provider if configured and client wants to send voice input.
    // asrConfig.settings is optional — all provider settings schemas use defaults, so null/undefined
    // is coerced to {} and each provider falls back to its own defaults.
    if (project.acceptVoice && project.asrConfig?.asrProviderId && this.session.sessionSettings.sendVoiceInput) {
      const asrProviderEntity = await db.query.providers.findFirst({ where: (providers, { eq }) => eq(providers.id, project.asrConfig.asrProviderId) });
      if (asrProviderEntity) {
        stageData.asrProvider = await this.asrProviderFactory.createProvider(asrProviderEntity, project.asrConfig.settings ?? {});
      } else {
        throw new NotFoundError(`ASR Provider with ID ${project.asrConfig.asrProviderId} not found`);
      }
    } else if (this.session.sessionSettings.sendVoiceInput) {
      logger.warn({ conversationId: conversation.id, projectId: project?.id, acceptVoice: project?.acceptVoice, asrProviderId: project?.asrConfig?.asrProviderId ?? null }, `Session requests voice input but ASR provider will not be initialised (acceptVoice=${project?.acceptVoice}, asrProviderId=${project?.asrConfig?.asrProviderId ?? 'unset'}). Both must be set. Voice input will be unavailable.`);
    }

    // Initialize moderation provider if configured on the project
    if (project.moderationConfig?.enabled && project.moderationConfig.llmProviderId) {
      const moderationProviderEntity = await db.query.providers.findFirst({ where: (providers, { eq }) => eq(providers.id, project.moderationConfig.llmProviderId) });
      if (moderationProviderEntity) {
        stageData.moderationProvider = await this.llmProviderFactory.createProviderForEnumeration(moderationProviderEntity);
        await stageData.moderationProvider.init();
      } else {
        logger.warn({ projectId: project.id, llmProviderId: project.moderationConfig.llmProviderId }, 'Moderation provider not found, moderation will be skipped');
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
          this.clearBargeInSilenceTimer();
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
          this.clearBargeInSilenceTimer();
          chunkOrdinal = 0;
        });

        asrProvider.setOnRecognitionStopped(async () => {
          const asrEndMs = Date.now();
          this.clearBargeInSilenceTimer(); // just in case the silence timer was still running when recognition stopped

          // If recognition stopped while we are NOT in an active voice turn (e.g. a pre-warmed
          // session timed out during silence), discard the event and clear the pre-warm promise
          // so the next speech_start will do a fresh start().
          // if (this.conversation.status !== 'receiving_user_voice') {
          //   this.asrPreWarmPromise = null;
          //   logger.info({ conversationId }, `ASR session ended during pre-warm (no active turn) for conversation ${conversationId}`);
          //   return;
          // }

          logger.info({ conversationId }, `ASR recognition stopped for conversation ${conversationId}`);

          isRecognizing = false;
          const allTextChunks = asrProvider.getAllTextChunks();
          const fullText = allTextChunks.map(chunk => chunk.text).join(' ').trim();

          if (this.isBargeIn && fullText) {
            this.bargeInPartialText = this.bargeInPartialText ? `${this.bargeInPartialText} ${fullText}`.trim() : fullText;
            logger.info({ conversationId }, `Barge-in: processing accumulated text`);
            await this.processUserInput(this.bargeInPartialText, 'voice', asrEndMs);
            return;
          }

          if (fullText) {
            logger.debug({ conversationId, chunkCount: allTextChunks.length }, `ASR complete text for conversation ${conversationId}`);
            await this.processUserInput(fullText, 'voice', asrEndMs);
          } else if (this.isBargeIn && this.bargeInPartialText) {
            logger.info({ conversationId }, `Barge-in: ASR timed out with silence, processing accumulated text`);
            await this.processUserInput(this.bargeInPartialText, 'voice', asrEndMs);
          } else if (this.isVadMode) {
            logger.warn({ conversationId }, `No text recognized in VAD mode for conversation ${conversationId}, ignoring unintelligible audio`);
            await this.triggerBargeInSilenceResponse();
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
        // Set up server-side VAD processor if configured (intercepts post-conversion PCM audio)
        await this.setupVadProcessor(asrProvider, conversationId);
      } catch (error) {
        logger.error({ conversationId, error: error instanceof Error ? error.message : String(error) }, `Failed to initialize ASR provider for conversation ${conversationId}`);
        throw error;
      }
    }

    // Initialize and wire up TTS provider
    if (ttsProvider) {
      try {
        await ttsProvider.init();

        // Get the TTS output format from provider configuration
        const receiveAudioFormat = this.session.sessionSettings.receiveAudioFormat ?? 'pcm_16000';
        const ttsNativeFormat = ttsProvider.getOutputFormat();

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
          const { startMs, assistantMessageEventId, outputTurnId, ttsStartMs, firstAudioMs, turnIndex, fillerSentence: snapshotFillerSentence, prescriptedText: snapshotPrescriptedText } = this.turnData;
          const ttsEndMs = Date.now();

          // Record total turn duration and TTS duration now that all audio has been sent
          const totalTurnDurationMs = startMs !== null ? ttsEndMs - startMs : undefined;
          const ttsDurationMs = ttsStartMs !== null ? ttsEndMs - ttsStartMs : undefined;
          if (assistantMessageEventId) {
            const backfill: Record<string, any> = {};
            if (totalTurnDurationMs !== undefined) backfill.totalTurnDurationMs = totalTurnDurationMs;
            if (ttsDurationMs !== undefined) backfill.ttsDurationMs = ttsDurationMs;
            if (startMs !== null) backfill.turnStartMs = startMs;
            backfill.turnEndMs = ttsEndMs;
            if (ttsStartMs !== null) backfill.ttsStartMs = ttsStartMs;
            backfill.ttsEndMs = ttsEndMs;
            if (firstAudioMs !== null) backfill.firstAudioMs = firstAudioMs;
            if (firstAudioMs !== null && startMs !== null) backfill.timeToFirstAudioMs = firstAudioMs - startMs;
            if (turnIndex !== null) backfill.turnIndex = turnIndex;
            if (Object.keys(backfill).length > 0) {
              const updated = await this.conversationService.updateConversationEventMetadata(this.conversation.projectId, assistantMessageEventId, backfill);
              if (!updated) {
                logger.warn({ conversationId: this.conversation.id, eventId: assistantMessageEventId }, 'Failed to backfill TTS timing metadata');
              } else {
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
          }

          // Send AI response end notification to client through channel
          // TODO: we need a dedicated message for sending full text after TTS generation is complete, as end_ai_voice_output is more about signaling the end of audio output, not necessarily tied to the text content
          const llmText = extractTextFromContent(this.stageData.lastCompletionResult?.content ?? []);
          const baseText = snapshotPrescriptedText ?? llmText;
          const ttsEndFillerPrefix = snapshotFillerSentence ? `${snapshotFillerSentence} ` : '';
          const endMessage: CALEndAiGenerationOutputMessage = {
            type: 'end_ai_generation_output',
            conversationId,
            outputTurnId,
            fullText: `${ttsEndFillerPrefix}${baseText}`.trim(),
          };
          try {
            await this.channel.sendMessage(endMessage);
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error({ conversationId, error: errorMessage }, `Failed to send AI response message: ${errorMessage}`);
            await this.markAsFailed(`Failed to send AI response message: ${errorMessage}`);
            return;
          }

          await this.handlePostResponseAction();
        });

        ttsProvider.setOnSpeechGenerating(async (chunk) => {
          this.recorder?.pushOutput(chunk.audio);
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
        this.turnData.accumulatedText = `${this.turnData.accumulatedText || ''}${chunk.content}`;
        if (ttsProvider) {
          this.ttsUsedInTurn = true;
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
        const fillerPrefix = this.turnData.fillerSentence ? `${this.turnData.fillerSentence} ` : '';
        const fullResponseText = `${fillerPrefix}${textContent}`.trim();
        const contentSize = getContentSize(result.content);
        const llmEndMs = Date.now();

        logger.info({ conversationId, totalTokens: result.usage?.totalTokens, contentBlocks: result.content.length }, `LLM completion finished for conversation ${conversationId}: ${contentSize} bytes in ${result.content.length} content blocks, ${result.usage?.totalTokens} tokens used`);
        this.stageData.lastCompletionResult = result;

        // Compute turn timings available at LLM completion time
        const llmDurationMs = this.turnData.llmStartMs !== null ? llmEndMs - this.turnData.llmStartMs : undefined;
        const timeToFirstTokenMs = this.turnData.firstTokenMs !== null && this.turnData.llmStartMs !== null ? this.turnData.firstTokenMs - this.turnData.llmStartMs : undefined;
        const timeToFirstTokenFromTurnStartMs = this.turnData.firstTokenMs !== null && this.turnData.startMs !== null ? this.turnData.firstTokenMs - this.turnData.startMs : undefined;
        const timeToFirstAudioMs = this.turnData.firstAudioMs !== null && this.turnData.startMs !== null ? this.turnData.firstAudioMs - this.turnData.startMs : undefined;
        const ttsConnectDurationMs = this.turnData.ttsConnectStartMs !== null && this.turnData.ttsConnectEndMs !== null ? this.turnData.ttsConnectEndMs - this.turnData.ttsConnectStartMs : undefined;
        const promptRenderDurationMs = this.turnData.promptRenderStartMs !== null && this.turnData.promptRenderEndMs !== null ? this.turnData.promptRenderEndMs - this.turnData.promptRenderStartMs : undefined;
        const stageTransitionDurationMs = this.turnData.stageTransitionStartMs !== null && this.turnData.stageTransitionEndMs !== null ? this.turnData.stageTransitionEndMs - this.turnData.stageTransitionStartMs : undefined;
        // For the text-only path, total turn duration is known now; for the TTS path it will be updated in setOnGenerationEnded
        const totalTurnDurationMs = !ttsProvider && this.turnData.startMs !== null ? llmEndMs - this.turnData.startMs : undefined;
        const turnEndMs = !ttsProvider ? llmEndMs : undefined;

        // Save AI message event with usage info and timing metrics
        const messageEventData: MessageEventData = {
          text: fullResponseText,
          role: 'assistant',
          originalText: fullResponseText,
          visibility: this.turnMessageVisibility,
          metadata: {
            llmUsage: buildLlmUsage(result.usage, this.stageData.completionLlmProviderInfo, this.stageData.stage.llmSettings?.model, this.turnData.completionTruncationInfo ?? undefined),
            fillerLlmUsage: this.turnData.fillerLlmUsage ?? undefined,
            systemPrompt: this.stageData.lastCompletionPrompt,
            outputTurnId: this.turnData.outputTurnId,
            turnIndex: this.turnData.turnIndex,
            turnStartMs: this.turnData.startMs ?? undefined,
            ttsConnectStartMs: this.turnData.ttsConnectStartMs ?? undefined,
            ttsConnectEndMs: this.turnData.ttsConnectEndMs ?? undefined,
            ttsConnectDurationMs,
            promptRenderStartMs: this.turnData.promptRenderStartMs ?? undefined,
            promptRenderEndMs: this.turnData.promptRenderEndMs ?? undefined,
            promptRenderDurationMs,
            llmStartMs: this.turnData.llmStartMs ?? undefined,
            llmEndMs,
            firstTokenMs: this.turnData.firstTokenMs ?? undefined,
            firstAudioMs: this.turnData.firstAudioMs ?? undefined,
            llmDurationMs,
            timeToFirstTokenMs,
            timeToFirstTokenFromTurnStartMs,
            timeToFirstAudioMs,
            totalTurnDurationMs,
            turnEndMs,
            moderationDurationMs: this.turnData.moderationDurationMs ?? undefined,
            fillerPrompt: this.lastFillerPrompt ?? undefined,
            fillerSentence: this.turnData.fillerSentence ?? undefined,
          },
        };
        this.turnData.assistantMessageEventId = await this.saveAndSendEvent('message', messageEventData);

        if (!ttsProvider) {
          // send end generation message to client to signal that response is complete and change state to awaiting user input
          const endGenerationMessage: CALEndAiGenerationOutputMessage = {
            type: 'end_ai_generation_output',
            conversationId,
            outputTurnId: this.turnData.outputTurnId,
            fullText: fullResponseText,
          };
          try {
            await this.channel.sendMessage(endGenerationMessage);
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error({ conversationId, error: errorMessage }, `Failed to send AI response message: ${errorMessage}`);
            await this.markAsFailed(`Failed to send AI response message: ${errorMessage}`);
            return;
          }
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

    // Initialize recording if enabled
    if (this.stageData.project.recordingConfig?.enabled) {
      try {
        const inputFormat = this.session.sessionSettings.sendAudioFormat ?? 'pcm_16000';
        const outputFormat = ttsProvider?.getOutputFormat() ?? 'pcm_16000';
        this.recorder = new ConversationRecorder(
          this.stageData.project.recordingConfig,
          inputFormat,
          outputFormat,
          this.conversationStorageService,
          this.stageData.project.storageConfig,
          this.stageData.project.id,
          conversationId,
        );
        await this.recorder.initialize();
        logger.info({ conversationId, format: this.recorder.constructor.name }, `Recording initialized for conversation ${conversationId}`);
      } catch (error) {
        logger.error({ conversationId, error: error instanceof Error ? error.message : String(error) }, `Failed to initialize recording for conversation ${conversationId}`);
      }
    }
  }

  async startConversation() {
    this.responseGeneratedInTurn = false;
    this.resetTurnData();
    if (this.conversation.status !== 'initialized') {
      throw new InvalidOperationError(`Cannot start conversation in current state: ${this.conversation.status}`);
    }

    const eventData: ConversationStartEventData = {
      stageId: this.stageData.id,
      initialVariables: this.conversation.stageVars?.[this.stageData.id] || {},
    };
    await this.saveAndSendEvent('conversation_start', eventData);
    logger.info({ conversationId: this.conversation.id, stageId: this.stageData.id }, 'Conversation started');

    const context = await this.contextBuilder.buildContextForConversationStart(this.conversation, this.channel?.connectionType);

    // Execute __conversation_start global lifecycle action if defined
    const onConversationStartAction = this.conversationLifecycleActions.get(CONVERSATION_LIFECYCLE_ACTION_IDS.ON_START);
    if (onConversationStartAction) {
      logger.debug({ conversationId: this.conversation.id }, 'Executing __conversation_start lifecycle action');
      const startingStageId = this.stageData.id;
      const startOutcome = await this.actionsExecutor.executeActions([onConversationStartAction], context, startingStageId, 'conversation_start', this.saveAndSendEvent.bind(this));
      await this.applyActionOutcome(context, startOutcome);
      // If ON_START navigated to a different stage, goToStage already ran on_enter and applied
      // enterBehavior for the destination — nothing left to do here.
      if (startOutcome.goToStageId && startOutcome.goToStageId !== startingStageId) {
        return;
      }
    }

    // Execute __on_enter lifecycle action if defined
    let enterOutcome: ActionsExecutionOutcome | null = null;
    const onEnterAction = this.stageData.stage.actions[LIFECYCLE_ACTION_NAMES.ON_ENTER];
    if (onEnterAction) {
      enterOutcome = await this.actionsExecutor.executeActions([onEnterAction], context, this.stageData.id, 'on_enter', this.saveAndSendEvent.bind(this));
      await this.applyActionOutcome(context, enterOutcome);

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
      throw new InvalidOperationError(`Cannot resume conversation in state: ${this.conversation.status}`);
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
      const resumeContext = await this.contextBuilder.buildContextForConversationStart(this.conversation, this.channel?.connectionType);
      const resumeOutcome = await this.actionsExecutor.executeActions([onConversationResumeAction], resumeContext, this.stageData.id, 'conversation_resume', this.saveAndSendEvent.bind(this));
      await this.applyActionOutcome(resumeContext, resumeOutcome);
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
    const endContext = await this.contextBuilder.buildContextForConversationStart(this.conversation, this.channel?.connectionType);
    const endOutcome = await this.actionsExecutor.executeActions([onConversationEndAction], endContext, this.stageData.id, 'conversation_end', this.saveAndSendEvent.bind(this));
    await this.applyActionOutcome(endContext, endOutcome);
  }

  async receiveUserTextInput(userInput: string): Promise<string> {
    if (this.conversation.status !== 'awaiting_user_input') {
      throw new InvalidOperationError(`Cannot receive user input in current state: ${this.conversation.status}`);
    }

    // In VAD mode, stop the pre-warmed ASR session and clear it so the state machine is clean
    // before processing text input. An active ASR session would still be listening and could
    // fire recognition callbacks that interfere with the text turn.
    if (this.isVadMode) {
      this.asrPreWarmPromise = null;
      if (this.stageData.asrProvider) {
        try {
          await this.stageData.asrProvider.stop();
          logger.info({ conversationId: this.conversation.id }, 'Stopped pre-warmed ASR session for text input');
        } catch (error) {
          logger.warn({ conversationId: this.conversation.id, error: error instanceof Error ? error.message : String(error) }, 'Failed to stop pre-warmed ASR for text input (non-fatal)');
        }
      }
    }

    this.turnData.inputTurnId = generateId(ID_PREFIXES.INPUT);
    await this.processUserInput(userInput, 'text');
    return this.turnData.inputTurnId;
  }

  async startUserVoiceInput(): Promise<string> {
    if (this.isVadMode) {
      // In VAD mode, the turn lifecycle is managed server-side; this is a no-op for clients.
      return this.turnData.inputTurnId ?? '';
    }

    if (this.conversation.status !== 'awaiting_user_input') {
      throw new InvalidOperationError(`Cannot start receiving user voice input in current state: ${this.conversation.status}`);
    }

    if (!this.stageData.asrProvider) {
      const errorMessage = `ASR provider not available for conversation ${this.stageData.conversation.id}. Ensure the project has acceptVoice=true and a valid asrConfig.asrProviderId configured.`;
      await this.markAsFailed(errorMessage);
      throw new InvalidOperationError(errorMessage);
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
    if (this.isVadMode) {
      // In VAD mode, feed audio to the converter/VAD in all active (non-terminal) states.
      // This is essential for channels that stream audio continuously (e.g. Twilio Voice):
      // dropping audio during generating_response or processing_user_input would cause VAD
      // to miss the caller's speech, since changeState('awaiting_user_input') resets the VAD
      // to give it a clean slate. ASR is guarded separately in setupInboundConverter's data
      // handler — it only receives audio when state is receiving_user_voice.
      const terminalStates = ['finished', 'failed', 'aborted', 'initialized'];
      if (terminalStates.includes(this.conversation.status)) return;

      this.recorder?.pushInput(voiceData);
      if (this.inboundConverter) {
        this.inboundConverter.push(voiceData);
      } else if (this.vadProcessor) {
        // No converter: feed VAD directly and stream to ASR when speech is active.
        this.vadProcessor.push(voiceData);
        if (this.conversation.status === 'receiving_user_voice') {
          await this.forwardToAsr(voiceData);
        }
      }
      return;
    }

    if (this.conversation.status === 'awaiting_user_input') {
      // Audio can arrive before startUserVoiceInput is called (e.g. WebRTC unordered channel
      // delivering an audio frame before the control-channel start signal, or a client that
      // streams briefly before acknowledging our state). Silently drop so the conversation is not
      // disrupted; the client will receive no transcription and should retry once it sends the
      // start signal and hears back that state is receiving_user_voice.
      return;
    }

    if (this.conversation.status !== 'receiving_user_voice') {
      throw new InvalidOperationError(`Cannot receive user voice data in current state: ${this.conversation.status}`);
    }

    if (this.turnData.inputTurnId !== inputTurnId) {
      throw new InvalidOperationError(`Input turn ID mismatch: expected ${this.turnData.inputTurnId}, got ${inputTurnId}`);
    }

    if (!this.stageData.asrProvider) {
      const errorMessage = `ASR provider not available for conversation ${this.stageData.conversation.id}. Ensure the project has acceptVoice=true and a valid asrConfig.asrProviderId configured.`;
      await this.markAsFailed(errorMessage);
      throw new InvalidOperationError(errorMessage);
    }

    try {
      this.recorder?.pushInput(voiceData);
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
    if (this.isVadMode) {
      // In VAD mode, end-of-utterance is managed server-side; this is a no-op for clients.
      return;
    }

    if (this.conversation.status !== 'receiving_user_voice') {
      throw new InvalidOperationError(`Cannot stop receiving user voice input in current state: ${this.conversation.status}`);
    }
    if (this.turnData.inputTurnId !== inputTurnId) {
      throw new InvalidOperationError(`Input turn ID mismatch: expected ${this.turnData.inputTurnId}, got ${inputTurnId}`);
    }

    if (!this.stageData.asrProvider) {
      const errorMessage = `ASR provider not available for conversation ${this.stageData.conversation.id}. Ensure the project has acceptVoice=true and a valid asrConfig.asrProviderId configured.`;
      await this.markAsFailed(errorMessage);
      throw new InvalidOperationError(errorMessage);
    }

    try {
      // Signal end of input to the inbound converter so it can flush any buffered data to ASR
      this.inboundConverter?.end();
      // Do NOT change state here: ASR providers close the stream/socket and return immediately,
      // firing onRecognitionStopped asynchronously (e.g. Azure sessionStopped, Deepgram close
      // event). Changing state to processing_user_input before that callback fires causes its
      // guard (status !== 'receiving_user_voice') to bail out early, swallowing the transcript.
      // processUserInput() — called from onRecognitionStopped — is the correct place to
      // transition to processing_user_input, mirroring how handleVadEndOfUtterance works.
      await this.stageData.asrProvider.stop();

      logger.info({ conversationId: this.stageData.conversation.id }, `Stopped voice input for conversation ${this.stageData.conversation.id}`);
    } catch (error) {
      const errorMessage = `Failed to stop voice input: ${error instanceof Error ? error.message : String(error)}`;
      await this.markAsFailed(errorMessage);
      logger.error({ conversationId: this.stageData.conversation.id, error: error instanceof Error ? error.message : String(error) }, `Failed to stop voice input for conversation ${this.stageData.conversation.id}`);
      throw error;
    }
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
    this.vadProcessor?.destroy();
    this.vadProcessor = null;
    this.clearSmartTurnContinueTimer();
    this.smartTurnAudioBuffer = null;

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

    this.recorder?.destroy();
    this.recorder = null;

    logger.info({ conversationId }, 'ConversationRunner cleanup complete');
  }

  /**
   * Navigate to a specific stage in the conversation
   * @param stageId - ID of the stage to navigate to
   * @param isProcessingUserInput - Whether navigation is triggered mid-turn
   * @param sourceActionName - Name of the action that triggered this navigation, if any
   */
  async goToStage(stageId: string, isProcessingUserInput: boolean = false, sourceActionName?: string): Promise<void> {
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
        ? this.conversation.status === 'awaiting_user_input' || this.conversation.status === 'processing_user_input' || this.conversation.status === 'initialized'
        : this.conversation.status === 'awaiting_user_input';
      if (!allowed) {
        throw new InvalidOperationError(`Cannot navigate to stage in current state: ${this.conversation.status}`);
      }

      const fromStageId = this.stageData.id;
      const oldStageData = this.stageData;

      // Execute __on_leave lifecycle action if defined on current stage
      const onLeaveAction = oldStageData.stage.actions[LIFECYCLE_ACTION_NAMES.ON_LEAVE];
      if (onLeaveAction) {
        logger.debug({ conversationId: this.conversation.id, stageId: fromStageId }, 'Executing __on_leave lifecycle action');
        const context = await this.contextBuilder.buildContextForLifecycleAction(oldStageData.conversation, oldStageData.stage, this.channel?.connectionType);
        const leaveOutcome = await this.actionsExecutor.executeActions([onLeaveAction], context, oldStageData.id, 'on_leave', this.saveAndSendEvent.bind(this));

        await this.applyActionOutcome(context, leaveOutcome);

        // If on_leave ended or aborted conversation, don't proceed
        if (leaveOutcome.shouldEndConversation || leaveOutcome.shouldAbortConversation) {
          return;
        }
      }

      // If a filler TTS session was open on the departing stage's provider, signal end-of-text
      // immediately so it can flush its buffer concurrently with the new stage being built.
      // We await full drain after wireUpProviders() to prevent filler audio and response audio
      // from interleaving at the client side.
      const priorTtsProvider = this.responseOutputTurnStarted ? (oldStageData.ttsProvider ?? null) : null;
      let resolvePriorTtsDrained: () => void = () => { };
      const priorTtsEndedPromise: Promise<void> = new Promise<void>(r => { resolvePriorTtsDrained = r; });
      if (priorTtsProvider) {
        priorTtsProvider.setOnGenerationEnded(async () => {
          logger.debug({ conversationId: this.conversation.id }, 'Prior-stage TTS provider drained after stage transition');
          resolvePriorTtsDrained();
        });
        priorTtsProvider.setOnError(async () => {
          logger.warn({ conversationId: this.conversation.id }, 'Prior-stage TTS provider error while draining — unblocking stage transition');
          resolvePriorTtsDrained();
        });
        try {
          await priorTtsProvider.end();
        } catch (err) {
          logger.warn({ conversationId: this.conversation.id, message: err instanceof Error ? err.message : String(err) }, 'Failed to end prior-stage TTS provider during stage transition — unblocking');
          resolvePriorTtsDrained();
        }
      } else {
        resolvePriorTtsDrained();
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

      // Wait for the prior-stage TTS provider to fully drain before starting the new one.
      // This prevents filler audio chunks (prior provider) and response audio chunks (new
      // provider) from interleaving at the client, and ensures ordinal counters are reset
      // cleanly by the new provider's setOnGenerationStarted before it begins streaming.
      await priorTtsEndedPromise;

      // If filler already opened the output turn, start the new stage's TTS provider now.
      // generateResponse() skips ttsProvider.start() when responseOutputTurnStarted is true,
      // so the new provider must be ready before the LLM begins sending text chunks.
      if (this.responseOutputTurnStarted && this.stageData.ttsProvider) {
        this.turnData.ttsConnectStartMs = Date.now();
        await this.stageData.ttsProvider.start();
        this.turnData.ttsConnectEndMs = Date.now();
      }

      const eventData: JumpToStageEventData = {
        fromStageId,
        toStageId: stageId,
        sourceActionName,
      };
      await this.saveAndSendEvent('jump_to_stage', eventData);

      // Execute __on_enter lifecycle action if defined on new stage
      const enterContext = await this.contextBuilder.buildContextForLifecycleAction(this.stageData.conversation, this.stageData.stage, this.channel?.connectionType);
      let enterOutcome: ActionsExecutionOutcome | null = null;
      const onEnterAction = this.stageData.stage.actions[LIFECYCLE_ACTION_NAMES.ON_ENTER];
      if (onEnterAction) {
        logger.debug({ conversationId: this.conversation.id, stageId }, 'Executing __on_enter lifecycle action');
        enterOutcome = await this.actionsExecutor.executeActions([onEnterAction], enterContext, this.stageData.id, 'on_enter', this.saveAndSendEvent.bind(this));

        await this.applyActionOutcome(enterContext, enterOutcome);

        // If on_enter ended or aborted conversation, don't proceed
        if (enterOutcome.shouldEndConversation || enterOutcome.shouldAbortConversation) {
          return;
        }
      }

      // Stage setup is complete (providers wired, on_enter executed) — mark end before response generation
      if (this.turnData.stageTransitionStartMs !== null && this.turnData.stageTransitionEndMs === null) {
        this.turnData.stageTransitionEndMs = Date.now();
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
      throw new InvalidOperationError(`Stage ID mismatch: expected ${this.stageData.id}, got ${stageId}`);
    }
    if (this.conversation.status !== 'awaiting_user_input') {
      throw new InvalidOperationError(`Cannot set variable in current state: ${this.conversation.status}`);
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

    const variablesUpdatedEventData: VariablesUpdatedEventData = { sourceActionName: 'set_var', changedVariableNames: [variableName], variables: this.conversation.stageVars?.[stageId] ?? {} };
    await this.saveAndSendEvent('variables_updated', variablesUpdatedEventData);

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
      throw new InvalidOperationError(`Stage ID mismatch: expected ${this.stageData.id}, got ${stageId}`);
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
      throw new InvalidOperationError(`Stage ID mismatch: expected ${this.stageData.id}, got ${stageId}`);
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
      throw new InvalidOperationError(`Cannot run action in current state: ${this.conversation.status}`);
    }

    // Reset per-turn data so timing fields are clean for this client-initiated action turn,
    // just like processUserInput does at the start of each user turn.
    this.responseGeneratedInTurn = false;
    this.resetTurnData();

    // Find the action in the already-loaded stage global actions.
    // Match by id first (clients send the action ID, e.g. "gact_..."), then fall back to name.
    const globalAction = this.stageData.globalActions.find(a => a.id === actionName || a.name === actionName);

    const stageAction = this.stageData.stage.actions[actionName];

    if (!globalAction && !stageAction) {
      throw new NotFoundError(`Action ${actionName} not found in project ${this.stageData.project.id}`);
    }

    const actionToExecute = stageAction || globalAction;
    logger.info({ conversationId: this.conversation.id, actionName }, `Executing action ${actionName}`);
    const context = await this.contextBuilder.buildContextForAction(this.stageData.conversation, actionName, actionToExecute, parameters, this.channel?.connectionType);
    logger.debug({ conversationId: this.conversation.id, actionName }, `Built context for action ${actionName}`);
    const outcome = await this.actionsExecutor.executeActions([actionToExecute], context, this.stageData.id, null, this.saveAndSendEvent.bind(this));

    const shouldContinue = await this.applyActionOutcome(context, outcome);
    const isTerminalWithoutResponse = !outcome.shouldGenerateResponse &&
      (outcome.shouldAbortConversation || outcome.shouldEndConversation);
    if (isTerminalWithoutResponse) {
      // Defer the terminal event: set pendingPostResponseAction but do NOT execute it here.
      // RunActionHandler will call executePendingTerminalAction() after sending the run_action
      // response to guarantee conversation_aborted / conversation_end arrives after the acknowledgement.
      if (outcome.shouldAbortConversation) {
        this.pendingPostResponseAction = {
          name: outcome.abortConversationSourceAction,
          type: 'abort_conversation',
          abortReason: outcome.abortReason || 'Conversation aborted by action',
          context,
        };
      } else {
        this.pendingPostResponseAction = {
          name: outcome.endConversationSourceAction,
          type: 'end_conversation',
          endReason: outcome.endReason || 'Action execution completed conversation',
          context,
        };
      }
    } else if (shouldContinue || outcome.shouldAbortConversation || outcome.shouldEndConversation) {
      await this.generateResponse(context, outcome);
    }

    logger.info({ conversationId: this.conversation.id, actionName }, `Action ${actionName} executed`);
    return { status: 'completed', message: 'Action execution not yet implemented' };
  }

  /**
   * Executes any terminal action (end or abort) that was deferred by the most recent runAction() call.
   * Must be called by the handler AFTER the run_action response has been sent to the client so that
   * conversation_aborted / conversation_end events are always delivered after the acknowledgement.
   */
  async executePendingTerminalAction(): Promise<void> {
    if (this.pendingPostResponseAction) {
      await this.handlePostResponseAction();
    }
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
    const context = await this.contextBuilder.buildContextForUserInput(this.stageData.conversation, this.stageData.stage, [], '', '',
      this.sampleCopyDistributor.getOriginalCopies(), '', '', undefined, this.channel?.connectionType);

    // Execute the tool
    const executeResult = await this.toolExecutor.executeTool(tool, context, parameters, this.stageData.costManagementConfig);

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
        llmUsage: executeResult.llmUsage,
        durationMs: executeResult.durationMs,
        startMs: executeResult.startMs,
        endMs: executeResult.endMs,
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
      this.turnData.stageTransitionStartMs = Date.now();
      await this.goToStage(outcome.goToStageId, true, outcome.goToStageSourceAction);
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
      if (this.isVadMode && this.vadProcessor) {
        // Always feed VAD for speech detection; additionally stream to ASR when speech is active.
        this.vadProcessor.push(chunk);
        if (this.conversation.status === 'receiving_user_voice') {
          await this.forwardToAsr(chunk);
        }
      } else {
        await this.forwardToAsr(chunk);
      }
    });

    this.inboundConverter.on('error', async (err: Error) => {
      logger.error({ conversationId, error: err.message }, `Inbound audio converter error for conversation ${conversationId}: ${err.message}`);
      await this.markAsFailed(`Inbound audio converter error: ${err.message}`);
    });
  }

  /**
   * Forwards a PCM audio chunk directly to the ASR provider.
   * @param chunk 16-bit PCM audio buffer
   */
  private async forwardToAsr(chunk: Buffer): Promise<void> {
    if (!this.stageData.asrProvider) return;
    await this.stageData.asrProvider.sendAudio(chunk);
  }

  /**
   * Sets up the server-side VAD processor if serverVad is configured in the project's asrConfig
   * and the ASR input format is PCM. In VAD mode, the VAD owns the turn lifecycle: speech_start
   * generates the inputTurnId and starts ASR, end_of_utterance stops it.
   * @param asrProvider Initialized ASR provider
   * @param conversationId For log context
   */
  private async setupVadProcessor(asrProvider: IAsrProvider, conversationId: string): Promise<void> {
    const serverVadConfig = this.stageData.project.asrConfig?.serverVad;
    if (!serverVadConfig) return;

    const asrFormat = asrProvider.getSupportedInputFormats()[0] as AudioFormat;
    const sampleRate = VadProcessor.getSampleRateFromFormat(asrFormat);
    if (!sampleRate) {
      logger.warn({ conversationId, asrFormat }, `Server VAD is configured but ASR format ${asrFormat} is not PCM; server VAD disabled for conversation ${conversationId}`);
      return;
    }

    this.vadProcessor = new VadProcessor(sampleRate as 8000 | 16000 | 32000 | 48000, {
      algorithm: serverVadConfig.algorithm ?? 'legacy',
      ...serverVadConfig,
    } as ServerVadConfig);
    await this.vadProcessor.init();

    // Serialize all VAD event handlers via a promise chain. This prevents the race where
    // 'data' and 'end_of_utterance' fire synchronously before 'speech_start' has finished
    // starting the ASR provider, which would cause audio to be forwarded to an inactive ASR
    // and 'end_of_utterance' to return early (stuck in receiving_user_voice).
    let vadEventQueue: Promise<void> = Promise.resolve();
    const enqueueVadEvent = (fn: () => Promise<void>) => {
      vadEventQueue = vadEventQueue.then(fn).catch(err => {
        logger.error({ conversationId, error: err instanceof Error ? err.message : String(err) }, `VAD event handler error for conversation ${conversationId}`);
      });
    };

    this.vadProcessor.on('speech_start', () => enqueueVadEvent(() => this.handleVadSpeechStart()));
    // 'data' (batch utterance audio) is intentionally not wired: audio is streamed live to ASR
    // via the inbound converter / receiveUserVoiceData path while state === 'receiving_user_voice'.
    this.vadProcessor.on('utterance_audio', (audio: Float32Array) => {
      this.smartTurnAudioBuffer = audio;
    });
    this.vadProcessor.on('end_of_utterance', () => enqueueVadEvent(() => this.handleVadEndOfUtterance()));

    logger.info({ conversationId, asrFormat, sampleRate, algorithm: serverVadConfig.algorithm ?? 'legacy' }, `Server VAD processor initialized for conversation ${conversationId}`);
  }

  private async sendUserSpeakingStarted(): Promise<void> {
    // Send VAD signal that the user has started speaking
    try {
      const userSpeakingMsg: CALUserSpeakingStartedMessage = {
        type: 'user_speaking_started',
        conversationId: this.stageData.conversation.id,
        inputTurnId: this.turnData.inputTurnId,
      };
      await this.channel.sendMessage(userSpeakingMsg);
      logger.info({ conversationId: this.stageData.conversation.id, inputTurnId: this.turnData.inputTurnId }, 'Sent user_speaking_started message during barge-in');
    } catch (error) {
      logger.warn({ conversationId: this.stageData.conversation.id, error: error instanceof Error ? error.message : String(error) }, 'Failed to send user_speaking_started during barge-in');
    }
  }

  private async sendAbortAiGeneration(): Promise<void> {
    // Send abort message to client so it stops playing audio.
    try {
      const abortMessage: CALAbortAiGenerationOutputMessage = {
        type: 'abort_ai_generation_output',
        conversationId: this.stageData.conversation.id,
        outputTurnId: this.turnData.outputTurnId || '',
        accumulatedText: this.turnData.accumulatedText || '',
        abortTimestampMs: Date.now(),
      };
      await this.channel.sendMessage(abortMessage);
      this.waitingForPlaybackEnd = false; // Clear the flag to allow new responses to play after this barge-in
    } catch (error) {
      logger.warn({ conversationId: this.stageData.conversation.id, error: error instanceof Error ? error.message : String(error) }, 'Failed to send abort message during barge-in');
    }
  }

  async startAsrSessionIfNeeded(): Promise<void> {
    try {
      this.turnData.inputTurnId = generateId(ID_PREFIXES.INPUT);
      await this.changeState('receiving_user_voice');
      if (this.asrPreWarmPromise) {
        await this.asrPreWarmPromise;
        this.asrPreWarmPromise = null;
        this.stageData.asrProvider?.resetForNewTurn();
      } else {
        await this.stageData.asrProvider?.start();
      }

      // If VAD buffered any audio before ASR was started, send it now to avoid cutting off the start of the user's speech.
      if (this.vadProcessor) {
        await this.forwardToAsr(this.vadProcessor.getBufferedAudio());
        this.vadProcessor.clearBufferedAudio();
      }
    } catch (error) {
      logger.error({ conversationId: this.stageData.conversation.id, error: error instanceof Error ? error.message : String(error) }, `Failed to restart ASR during subsequent barge-in speech_start`);
    }
  }

  /**
     * Handles VAD speech start: generates a server-side inputTurnId, starts the ASR session,
     * and transitions to receiving_user_voice. From this point, every incoming audio chunk is
     * forwarded to ASR live (streaming mode). Acts when in awaiting_user_input state or during barge-in.
     */
  private async handleVadSpeechStart(): Promise<void> {
    // New speech detected — cancel any pending Smart Turn continuation timer.
    this.clearSmartTurnContinueTimer();

    // Scenario 1: New VAD reacted when awaiting_user_input: normal speech start or barge-in after TTS stopped.
    //          - a: Normal speech start: awaiting_user_input && !this.waitingForPlaybackEnd
    //          - b: interrupted buffered AI voice: awaiting_user_input && this.waitingForPlaybackEnd (technically it is a barge-in, but we don't care at this point)
    if (this.conversation.status === 'awaiting_user_input') {
      logger.info({ status: this.conversation.status }, '**VAD** Handling VAD speech start in awaiting_user_input state');
      if (this.waitingForPlaybackEnd) { // 1a
        // send abort_ai_generation_output && user_speaking_started
        await this.sendAbortAiGeneration();
        await this.sendUserSpeakingStarted();
        // ASR is started here because of awaiting_user_input state
        await this.startAsrSessionIfNeeded();
        // real interruption so kick off barge-in silence timer to stop ASR if user stops speaking
        this.setBargeInSilenceTimer();
      } else { // 1b
        // send user_speaking_started only (no need to abort AI generation since it already stopped when waitingForPlaybackEnd was set)
        await this.sendUserSpeakingStarted();
        // start ASR in response to VAD (if not started already)
        await this.startAsrSessionIfNeeded();
        // kick off barge-in silence timer to stop ASR if user stops speaking
        this.setBargeInSilenceTimer();
      }
      return;
    }

    // Scenario 2: VAD reacted when receiving_user_voice
    if (this.conversation.status === 'receiving_user_voice') {
      // The question here is why this happened.
      logger.info({ status: this.conversation.status }, '**VAD** Handling VAD speech start in receiving_user_voice state');
      await this.setBargeInSilenceTimer();
      return;
    }

    // Scenario 3: VAD reacted when generating_response: barge-in interrupt during AI response generation.
    if (this.conversation.status === 'generating_response') {
      logger.info({ status: this.conversation.status }, '**VAD** Handling VAD speech start in generating_response state: barge-in interrupt');
      // abort TTS completely
      await this.abortCurrentResponse();
      // send abort_ai_generation_output && user_speaking_started
      await this.sendAbortAiGeneration();
      await this.sendUserSpeakingStarted();
      // start ASR in response to VAD (if not started already)
      await this.startAsrSessionIfNeeded();
      // kick off barge-in silence timer to stop ASR if user stops speaking
      this.setBargeInSilenceTimer();
      return;
    }

    // Scenario 4: VAD reacted when processing_user_input: we haven't even started generating a response yet
    if (this.conversation.status === 'processing_user_input') {
      logger.info({ status: this.conversation.status }, '**VAD** Ignoring VAD speech start in processing_user_input state');
      // TODO: this is a very complex scenario as we have in-flight processing that can cause status transitions.
      // We should consider whether we want to allow barge-in during processing_user_input, and if so, how to handle it.
      // For now, we will ignore the VAD to prevent very weird issues caused by race conditions.
      return;
    }

    logger.warn({ status: this.conversation.status }, `**VAD** Received speech_start in unexpected state ${this.conversation.status}`);
  }

  /**
       * Handles VAD end-of-utterance: stops the ASR session (signals EOF to the push stream so the
       * provider finalizes pending recognition). The setOnRecognitionStopped callback drives
      * processUserInput onward. Only acts when in receiving_user_voice state.
      * When Smart Turn is enabled, runs endpoint detection before stopping ASR.
       */
  private async handleVadEndOfUtterance(): Promise<void> {
    if (this.conversation.status === 'receiving_user_voice') {
      if (!this.stageData.asrProvider) return;

      const smartTurnConfig = this.stageData.project.asrConfig?.serverVad?.smartTurn;
      if (smartTurnConfig?.enabled && this.smartTurnAudioBuffer) {
        const shouldStop = await this.handleSmartTurnDetection(smartTurnConfig.threshold ?? 0.5);
        if (!shouldStop) {
          return;
        }
      }

      try {
        await this.stageData.asrProvider.stop();
        logger.info({ conversationId: this.stageData.conversation.id }, `VAD end-of-utterance, stopped ASR session for conversation ${this.stageData.conversation.id}`);
      } catch (error) {
        const errorMessage = `VAD end_of_utterance: failed to stop ASR: ${error instanceof Error ? error.message : String(error)}`;
        await this.markAsFailed(errorMessage);
        logger.error({ conversationId: this.stageData.conversation.id, error: error instanceof Error ? error.message : String(error) }, `VAD failed to stop ASR session for conversation ${this.stageData.conversation.id}`);
      }
      return;
    }

    // During barge-in with VAD reset skipped, end_of_utterance can fire while status is
    // awaiting_user_input (generation completed before the user finished speaking). Stop any
    // pre-warmed ASR session so it doesn't hang and waste resources — the next speech_start
    // will create a fresh session.
    if (this.isBargeIn && this.conversation.status === 'awaiting_user_input') {
      this.asrPreWarmPromise = null;
      try {
        await this.stageData.asrProvider?.stop();
        logger.info({ conversationId: this.stageData.conversation.id }, `VAD end-of-utterance during barge-in awaiting, stopped pre-warmed ASR for conversation ${this.stageData.conversation.id}`);
      } catch (error) {
        logger.warn({ conversationId: this.stageData.conversation.id, error: error instanceof Error ? error.message : String(error) }, `Failed to stop pre-warmed ASR during barge-in end-of-utterance (non-fatal)`);
      }
    }
  }

  /** Sets a timer to stop ASR if no speech is detected after a barge-in interrupt. */
  private setBargeInSilenceTimer(): void {
    if (this.bargeInSilenceTimer) {
      clearTimeout(this.bargeInSilenceTimer);
    }

    const timeout = this.stageData.project.asrConfig?.serverVad?.bargeInSilenceTimeout ?? 3000;
    logger.info({ timeout, conversationId: this.stageData.conversation.id }, '**VAD** Starting barge-in silence timer');
    this.bargeInSilenceTimer = setTimeout(async () => {
      this.bargeInSilenceTimer = null;
      logger.info({ conversationId: this.stageData.conversation.id }, '**VAD** Barge-in silence timeout reached, stopping ASR');
      try {
        await this.stageData.asrProvider?.stop();
        await this.triggerBargeInSilenceResponse();
      } catch (error) {
        logger.warn({ conversationId: this.stageData.conversation.id, error: error instanceof Error ? error.message : String(error) }, 'Failed to stop ASR after barge-in silence timeout (non-fatal)');
      }
    }, timeout);
  }

  /** Triggers the barge-in silence response */
  private async triggerBargeInSilenceResponse(): Promise<void> {
    const placeholder = this.stageData.project.asrConfig?.serverVad?.bargeInSilencePlaceholder
      ?? '[unintelligible]';
    await this.processUserInput(placeholder, 'voice');
  }

  /** Clears the barge-in silence timer if active. */
  private clearBargeInSilenceTimer(): void {
    if (this.bargeInSilenceTimer) {
      logger.info({ conversationId: this.stageData.conversation.id }, '**VAD** Clearing barge-in silence timer');
      clearTimeout(this.bargeInSilenceTimer);
      this.bargeInSilenceTimer = null;
    }
  }


  /**
   * Runs Smart Turn endpoint detection on the buffered utterance audio.
   * @param threshold Probability threshold for endpoint classification
   * @returns true if ASR should be stopped (endpoint confirmed or inference failed), false if continuation detected
   */
  private async handleSmartTurnDetection(threshold: number): Promise<boolean> {
    const audio = this.smartTurnAudioBuffer;
    this.smartTurnAudioBuffer = null;

    if (!audio || audio.length === 0) {
      return true;
    }

    try {
      const result = await smartTurnDetector.predict(audio);
      const conversationId = this.stageData.conversation.id;

      if (result.endpointProbability > threshold) {
        logger.info(
          { conversationId, endpointProbability: result.endpointProbability, threshold },
          'Smart Turn: endpoint confirmed'
        );
        return true;
      }

      logger.info(
        { conversationId, endpointProbability: result.endpointProbability, threshold },
        'Smart Turn: continuation detected, keeping ASR active'
      );

      this.clearSmartTurnContinueTimer();
      this.smartTurnContinueTimer = setTimeout(async () => {
        this.smartTurnContinueTimer = null;
        if (this.conversation.status === 'receiving_user_voice' && this.stageData.asrProvider) {
          try {
            await this.stageData.asrProvider.stop();
            logger.info({ conversationId }, 'Smart Turn: continuation timeout, stopped ASR');
          } catch (error) {
            logger.warn(
              { conversationId, error: error instanceof Error ? error.message : String(error) },
              'Smart Turn: failed to stop ASR on timeout (non-fatal)'
            );
          }
        }
      }, this.SMART_TURN_CONTINUE_TIMEOUT_MS);

      return false;
    } catch (error) {
      logger.warn(
        { conversationId: this.stageData.conversation.id, error: error instanceof Error ? error.message : String(error) },
        'Smart Turn inference failed, falling back to stopping ASR'
      );
      return true;
    }
  }

  /** Clears the Smart Turn continuation timer if active. */
  private clearSmartTurnContinueTimer(): void {
    if (this.smartTurnContinueTimer) {
      clearTimeout(this.smartTurnContinueTimer);
      this.smartTurnContinueTimer = null;
    }
  }

  /**
   * Handles barge-in interrupt: user speaks while AI is generating a response. Cancels TTS output,
   * sends abort message to client, and marks the runner for barge-in mode so the accumulated ASR
   * transcript (partial + new utterance) will be processed as a fresh turn when recognition stops.
   */
  public async abortCurrentResponse(): Promise<void> {
    // Already in barge-in mode — do nothing.
    if (this.isBargeIn) return;

    logger.info({ conversationId: this.stageData.conversation.id }, '**VAD** Barge-in interrupt detected');
    this.isBargeIn = true;

    // Cancel TTS output — the provider may still be streaming audio chunks.
    if (this.stageData.ttsProvider) {
      try {
        await this.stageData.ttsProvider.cancel();
        logger.info({ conversationId: this.stageData.conversation.id }, '**VAD** TTS cancelled due to barge-in interrupt');
      } catch (error) {
        logger.warn({ conversationId: this.stageData.conversation.id, error: error instanceof Error ? error.message : String(error) }, 'TTS cancel failed during barge-in (non-fatal)');
      }
    }
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
      // Last-chunk-buffer: buffer the new chunk immediately (synchronously, before any await) so that
      // the 'end' handler always sees the most recent chunk even if this handler suspends at the sendMessage await.
      const pending = this.outboundPendingChunk;
      this.outboundPendingChunk = {
        chunkId: generateId(ID_PREFIXES.CHUNK),
        ordinal: this.outboundOrdinalCounter++,
        audio: audioData,
      };
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
        const failedContext = await this.contextBuilder.buildContextForConversationStart(this.conversation, this.channel?.connectionType);
        const failedOutcome = await this.actionsExecutor.executeActions([onConversationFailedAction], failedContext, this.stageData.id, 'conversation_failed', this.saveAndSendEvent.bind(this));
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

    // Flush recorder before closing connection
    await this.recorder?.flush();

    // Close client connection on terminal state
    try {
      await this.session.clientConnection?.close();
    } catch (error) {
      logger.warn({ conversationId: this.conversation.id, error: error instanceof Error ? error.message : String(error) }, 'Failed to close client connection on failure');
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
    this.pendingPostResponseAction = null;
    this.turnData = {
      inputTurnId: this.turnData.inputTurnId,
      outputTurnId: undefined,
      startMs: Date.now(),
      promptRenderStartMs: null,
      promptRenderEndMs: null,
      llmStartMs: null,
      firstTokenMs: null,
      firstAudioMs: null,
      assistantMessageEventId: null,
      fillerDurationMs: null,
      fillerLlmUsage: null,
      moderationDurationMs: null,
      moderationStartMs: null,
      moderationEndMs: null,
      asrStartMs: null,
      stageTransitionStartMs: null,
      stageTransitionEndMs: null,
      ttsConnectStartMs: null,
      ttsConnectEndMs: null,
      ttsStartMs: null,
      turnIndex: this.turnData.turnIndex + 1,
      fillerSentence: null,
      prescriptedText: null,
      completionTruncationInfo: null,
      accumulatedText: null,
    };
  }

  private async processUserInput(userInput: string, userInputSource: 'text' | 'voice', asrEndMs?: number) {
    // Handle barge-in: prepend accumulated partial transcript from previous ASR sessions.
    if (this.isBargeIn && this.bargeInPartialText) {
      const abortedOutputTurnId = this.turnData.outputTurnId || null;
      userInput = `${this.bargeInPartialText} ${userInput}`.trim();
      logger.info({ conversationId: this.stageData.conversation.id, abortedOutputTurnId }, `Barge-in: processing accumulated transcript`);

      // Save turn_aborted event for the interrupted response.
      if (abortedOutputTurnId) {
        const turnAbortedEventData: TurnAbortedEventData = {
          inputTurnId: this.turnData.inputTurnId || '',
          outputTurnId: abortedOutputTurnId,
          accumulatedText: this.turnData.accumulatedText || '',
          abortTimestampMs: Date.now(),
        };
        try {
          await this.saveAndSendEvent('turn_aborted', turnAbortedEventData);
        } catch (error) {
          logger.warn({ conversationId: this.stageData.conversation.id, error: error instanceof Error ? error.message : String(error) }, 'Failed to save turn_aborted event during barge-in');
        }
      }
    }

    this.responseGeneratedInTurn = false;
    // Reset silence count on any real user input (not a silence placeholder).
    const silencePlaceholder = this.stageData.project.asrConfig?.silencePlaceholder ?? '**silence**';
    if (userInput !== silencePlaceholder) {
      this.silenceCount = 0;
    }
    // Capture asrStartMs and asrEndMs before resetting turnData so we can compute asrDurationMs and persist raw timestamps
    const savedAsrStartMs = this.turnData.asrStartMs;
    const savedAsrEndMs = asrEndMs ?? null;
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

    const isStrictModerationMode = this.stageData.project.moderationConfig?.mode !== 'standard';

    if (isStrictModerationMode) {
      // Strict mode (default): moderation fully resolves before any LLM call that receives user-derived content.
      // This prevents inappropriate content from reaching provider APIs and risking account bans.
      const moderationResult = await this.moderationService.moderate(userInput, this.stageData.moderationProvider, this.stageData.project.moderationConfig, this.conversation.projectId);
      const newUserInput = await this.handleModerationResult(moderationResult, userInput, userInputSource);
      if (newUserInput === null) {
        if (this.isBargeIn) { this.isBargeIn = false; this.bargeInPartialText = null; }
        return;
      }
      userInput = newUserInput;
    }

    // Filler delivery and classification run concurrently: filler LLM + TTS connect/send are
    // independent of classification (processTextInput), so both can start simultaneously.
    // The Promise.all below is the single synchronisation point; nothing that classificationor
    // filler reads/writes conflicts before that barrier.
    this.lastFillerSentence = null;
    this.lastFillerPrompt = null;
    const fillerStartMs = Date.now();

    // Kick off filler delivery without awaiting — open the response turn and feed TTS as soon
    // as the filler LLM responds, while classification proceeds in parallel.
    let fillerEndMs: number | null = null;
    const fillerDeliveryPromise: Promise<string | null> = (async () => {
      const fillerPrep = await this.prepareFillerMessages(userInput);
      if (!fillerPrep) return null;

      const { messages: fillerMessages, renderedPrompt, maxTokens, truncationInfo } = fillerPrep;
      const fillerLlm = this.stageData.fillerLlmProvider;
      const tts = this.stageData.ttsProvider;

      let accumulatedText = '';
      let firstChunk = true;
      let generationResult: LlmGenerationResult | null = null;
      let outputTurnId: string | null = null;

      const onCompletePromise = new Promise<LlmGenerationResult>((resolve) => {
        fillerLlm.setOnGenerationCompleted((result) => {
          generationResult = result;
          resolve(result);
        });
        fillerLlm.setOnError(async (_error: Error) => {
          resolve({ id: '', content: [], role: 'assistant', finishReason: 'stop' });
        });
      });

      const ttsPromise = tts
        ? (async () => {
          this.turnData.ttsConnectStartMs = Date.now();
          await tts.start();
          this.turnData.ttsConnectEndMs = Date.now();
        })()
        : Promise.resolve();
      const streamPromise = fillerLlm.generateStream(fillerMessages, maxTokens !== undefined ? { maxTokens } : undefined);

      fillerLlm.setOnChunk(async (chunk: LlmChunk) => {
        accumulatedText += chunk.content;

        if (firstChunk) {
          firstChunk = false;
          await ttsPromise;
          outputTurnId = generateId(ID_PREFIXES.OUTPUT);
          this.turnData.outputTurnId = outputTurnId;
          const startMsg: CALStartAiGenerationOutputMessage = {
            type: 'start_ai_generation_output',
            conversationId: this.conversation.id,
            outputTurnId: this.turnData.outputTurnId,
            expectVoice: !!tts,
          };
          await this.channel.sendMessage(startMsg);
          if (tts) {
            this.ttsUsedInTurn = true;
            await tts.sendText(chunk.content);
          }
          const chunkMsg: CALAiTranscribedChunkMessage = {
            type: 'ai_transcribed_chunk',
            conversationId: this.conversation.id,
            outputTurnId: this.turnData.outputTurnId,
            chunkId: generateId(ID_PREFIXES.CHUNK),
            chunkText: chunk.content,
            ordinal: 0,
            isFinal: false,
          };
          await this.channel.sendMessage(chunkMsg);
          this.responseOutputTurnStarted = true;
        } else {
          if (tts) {
            this.ttsUsedInTurn = true;
            await tts.sendText(chunk.content);
          }
          const chunkMsg: CALAiTranscribedChunkMessage = {
            type: 'ai_transcribed_chunk',
            conversationId: this.conversation.id,
            outputTurnId: this.turnData.outputTurnId,
            chunkId: generateId(ID_PREFIXES.CHUNK),
            chunkText: chunk.content,
            ordinal: 0,
            isFinal: false,
          };
          await this.channel.sendMessage(chunkMsg);
        }
      });

      await streamPromise;
      const result = await onCompletePromise;

      if (result) {
        this.turnData.fillerLlmUsage = buildLlmUsage(result.usage, this.stageData.fillerLlmProviderInfo, this.stageData.agent?.fillerSettings?.llmSettings?.model, truncationInfo) ?? null;
      }

      const finalText = accumulatedText.trim();
      if (finalText.length > 0) {
        this.lastFillerPrompt = renderedPrompt;
        this.lastFillerSentence = finalText;
        this.turnData.fillerSentence = finalText;
      }

      fillerEndMs = Date.now();
      if (finalText.length > 0) {
        this.turnData.fillerDurationMs = fillerEndMs - fillerStartMs;
      }

      return finalText.length > 0 ? finalText : null;
    })();

    // Standard mode: fire moderation in parallel with both filler delivery and classification.
    const parallelModerationPromise = isStrictModerationMode ? null : this.moderationService.moderate(userInput, this.stageData.moderationProvider, this.stageData.project.moderationConfig, this.conversation.projectId);

    // Kick off classification concurrently with filler delivery — neither depends on the other.
    const processingStartMs = Date.now();
    const processingPromise = this.userInputProcessor.processTextInput(this.session, userInput, userInput);

    // Wait for both filler delivery and classification to complete before proceeding.
    await Promise.all([fillerDeliveryPromise, processingPromise]);
    const processingResult = await processingPromise; // already resolved, no extra round-trip
    const processingEndMs = Date.now();
    const processingDurationMs = processingEndMs - processingStartMs;

    // Standard mode: await moderation (ran in parallel with processTextInput) and handle before classification.
    if (parallelModerationPromise) {
      const moderationResult = await parallelModerationPromise;
      const newUserInput = await this.handleModerationResult(moderationResult, userInput, userInputSource);
      if (newUserInput === null) {
        if (this.isBargeIn) { this.isBargeIn = false; this.bargeInPartialText = null; }
        return;
      }
      userInput = newUserInput;
    }

    const classificationResults = processingResult.actions;
    const knowledgeRetrievalDurationMs = processingResult.knowledgeRetrievalDurationMs;

    // Detect and handle knowledge actions - these are synthetic actions from the knowledge base
    const knowledgeResults = classificationResults.filter(r => r.name.startsWith('__knowledge_'));
    const nonKnowledgeResults = classificationResults.filter(r => !r.name.startsWith('__knowledge_'));

    if (knowledgeResults.length > 0) {
      const categoryIds = knowledgeResults.map(r => r.name.slice('__knowledge_'.length));
      const itemArrays = await Promise.all(categoryIds.map(id => this.knowledgeService.getItemsByCategory(this.conversation.projectId, id)));
      this.stageData.faq = itemArrays.flat().flatMap(item => item.questions.map(q => ({ question: q, answer: item.answer })));
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
    const selectedSampleCopyName = processingResult.sampleCopyResult?.sampleCopy ?? null;
    const sampleCopies = selectedSampleCopyName && this.sampleCopyDistributor.hasName(selectedSampleCopyName)
      ? this.sampleCopyDistributor.distributeCopies(selectedSampleCopyName)
      : [];
    const copyContent = sampleCopies.length > 0 ? sampleCopies.join('\n') : '';
    let copy = copyContent;
    if (copyContent.length > 0) {
      const sampleCopy = this.sampleCopyDistributor.getOriginalCopies().find(c => c.name === selectedSampleCopyName);
      if (sampleCopy) {
        // find decorator with matching projectId and sampleCopy.name
        const decorator = sampleCopy.decoratorId ? await db.query.copyDecorators.findFirst({
          where: (copyDecorators, { and, eq }) => and(
            eq(copyDecorators.projectId, this.conversation.projectId),
            eq(copyDecorators.id, sampleCopy.decoratorId)
          )
        }) : null;
        if (decorator) {
          const context = await this.contextBuilder.buildContextForUserInput(this.stageData.conversation,
            this.stageData.stage, nonKnowledgeResults, userInput, userInputSource, this.sampleCopyDistributor.getOriginalCopies(),
            copy, copyContent, this.stageData.faq, this.channel?.connectionType);
          copy = await this.templatingEngine.render(decorator.template, context);
        }
      }
    }
    const selectedSampleCopy = selectedSampleCopyName
      ? (this.sampleCopyDistributor.getOriginalCopies().find(c => c.name === selectedSampleCopyName) ?? null)
      : null;
    // When mode is 'forced', the distributed copy becomes a prescripted response — the LLM is bypassed
    // and response-related effects from actions are ignored.
    const forcedCopyResponse = sampleCopies.length > 0 && selectedSampleCopy?.mode === 'forced' ? copy : null;
    const context = await this.contextBuilder.buildContextForUserInput(this.stageData.conversation, this.stageData.stage, nonKnowledgeResults, userInput, userInputSource,
      this.sampleCopyDistributor.getOriginalCopies(), copy, copyContent, this.stageData.faq, this.channel?.connectionType);
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
    let actionsStartMs: number;
    let actionsEndMs: number;
    const onFallbackAction = this.stageData.stage.actions[LIFECYCLE_ACTION_NAMES.ON_FALLBACK];
    if (actions.length === 0 && onFallbackAction) {
      logger.debug({ conversationId: this.conversation.id }, 'No actions matched - executing __on_fallback lifecycle action');
      actionsStartMs = Date.now();
      executionOutcome = await this.actionsExecutor.executeActions([onFallbackAction], context, this.stageData.id, 'on_fallback', this.saveAndSendEvent.bind(this));
      actionsEndMs = Date.now();
      actionsDurationMs = actionsEndMs - actionsStartMs;
      await this.applyActionOutcome(context, executionOutcome);
    } else {
      actionsStartMs = Date.now();
      executionOutcome = await this.actionsExecutor.executeActions(actions, context, this.stageData.id, null, this.saveAndSendEvent.bind(this));
      actionsEndMs = Date.now();
      actionsDurationMs = actionsEndMs - actionsStartMs;
      await this.applyActionOutcome(context, executionOutcome);
    }

    if (forcedCopyResponse !== null) {
      logger.debug({ conversationId: this.conversation.id, sampleCopyName: selectedSampleCopyName }, 'Sample copy forced mode: overriding response with prescripted copy content, ignoring response-related effects');
      executionOutcome.prescriptedResponse = forcedCopyResponse;
      executionOutcome.shouldGenerateResponse = true;
    }

    if (executionOutcome.turnVisibility) {
      this.turnMessageVisibility = executionOutcome.turnVisibility;
    }

    // Update message event with moderation and processing results, which may be needed for response generation and should be sent to client for UI updates
    const updated = await this.conversationService.updateMessageEvent(this.conversation.projectId, userMessageEventId, context.userInput, {
      source: context.userInputSource,
      inputTurnId: this.turnData.inputTurnId,
      turnIndex: this.turnData.turnIndex,
      turnStartMs: this.turnData.startMs ?? undefined,
      asrStartMs: savedAsrStartMs ?? undefined,
      asrEndMs: savedAsrEndMs ?? undefined,
      asrDurationMs: asrDurationMsValue,
      moderationStartMs: this.turnData.moderationStartMs ?? undefined,
      moderationEndMs: this.turnData.moderationEndMs ?? undefined,
      moderationDurationMs: this.turnData.moderationDurationMs ?? undefined,
      fillerStartMs: this.turnData.fillerSentence ? fillerStartMs : undefined,
      fillerEndMs: this.turnData.fillerSentence ? (fillerEndMs ?? undefined) : undefined,
      fillerDurationMs: this.turnData.fillerDurationMs ?? undefined,
      processingStartMs,
      processingEndMs,
      processingDurationMs,
      knowledgeRetrievalStartMs: processingResult.knowledgeRetrievalStartMs,
      knowledgeRetrievalEndMs: processingResult.knowledgeRetrievalEndMs,
      knowledgeRetrievalDurationMs,
      actionsStartMs,
      actionsEndMs,
      actionsDurationMs,
      stageTransitionStartMs: this.turnData.stageTransitionStartMs ?? undefined,
      stageTransitionEndMs: this.turnData.stageTransitionEndMs ?? undefined,
      stageTransitionDurationMs: this.turnData.stageTransitionStartMs !== null && this.turnData.stageTransitionEndMs !== null ? this.turnData.stageTransitionEndMs - this.turnData.stageTransitionStartMs : undefined,
    }, this.turnMessageVisibility);
    if (!updated) {
      logger.warn({ conversationId: this.conversation.id, eventId: userMessageEventId }, 'Failed to update message event with processing metadata');
    } else {
      const messageUpdateMessage: CALConversationEventUpdateMessage = {
        type: 'conversation_event_update',
        conversationId: this.conversation.id,
        eventType: 'message',
        eventData: updated.eventData,
        inputTurnId: this.turnData.inputTurnId,
        outputTurnId: this.turnData.outputTurnId,
      };
      await this.channel.sendMessage(messageUpdateMessage);
    }

    await this.generateResponse(context, executionOutcome);
  }

  private async generateResponse(context: ConversationContext, executionOutcome: ActionsExecutionOutcome) {
    // Generate a response when the action succeeded and a generate_response effect is set.
    // Note: shouldAbortConversation no longer suppresses generation — the abort is deferred
    // until after response delivery via pendingPostResponseAction.
    const shouldGenerateResponse = executionOutcome.success && executionOutcome.shouldGenerateResponse;
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
          flushBuffer: true,
        };
        await this.channel.sendMessage(startGenerationMessage);

        if (this.stageData.ttsProvider) {
          this.turnData.ttsConnectStartMs = Date.now();
          await this.stageData.ttsProvider.start();
          this.turnData.ttsConnectEndMs = Date.now();
        }
      }
      await this.changeState('generating_response');
      if (executionOutcome.prescriptedResponse !== undefined) {
        await this.deliverPrescriptedResponse(executionOutcome.prescriptedResponse);
      } else {
        this.turnData.promptRenderStartMs = Date.now();
        this.stageData.lastCompletionPrompt = await this.templatingEngine.render(this.stageData.stage.prompt, context);
        this.turnData.promptRenderEndMs = Date.now();
        this.turnData.firstTokenMs = null;
        this.turnData.llmStartMs = Date.now();
        const completionLimits = resolveProviderModelLimits(this.stageData.costManagementConfig, this.stageData.completionLlmProviderInfo?.id ?? '', this.stageData.stage.llmSettings?.model);
        const completionMaxTokens = resolveOutputCap((this.stageData.stage.llmSettings as any)?.defaultMaxTokens, completionLimits, 'completion');
        const completionInputCap = completionLimits?.inputTokensLimits?.completion;
        await this.responseGenerator.generateResponse(context, this.stageData.stage, this.stageData.lastCompletionPrompt, this.stageData.completionLlmProvider, this.lastFillerSentence ?? undefined, completionMaxTokens, completionInputCap, this.stageData.stage.llmSettings?.model, (info) => { this.turnData.completionTruncationInfo = info; });
      }
      this.lastFillerSentence = null;
      this.lastFillerPrompt = null;

      // Schedule what happens after response delivery (including TTS audio) is complete.
      // For TTS paths this is executed by handlePostResponseAction() called from onGenerationEnded;
      // for non-TTS paths it is executed immediately below.
      if (executionOutcome.shouldEndConversation) {
        this.pendingPostResponseAction = { name: executionOutcome.endConversationSourceAction, type: 'end_conversation', endReason: executionOutcome.endReason || 'Action execution completed conversation', context };
      } else if (executionOutcome.shouldAbortConversation) {
        this.pendingPostResponseAction = { name: executionOutcome.abortConversationSourceAction, type: 'abort_conversation', abortReason: executionOutcome.abortReason || 'Conversation aborted by action', context };
      }

      if (!this.stageData.ttsProvider) {
        // No TTS: response was fully delivered synchronously — execute the terminal action now.
        await this.handlePostResponseAction();
      }
      // With TTS: audio is still streaming; handlePostResponseAction will be invoked from
      // ttsProvider.setOnGenerationEnded once all audio has been delivered to the client.
    } else if (executionOutcome.shouldAbortConversation) {
      // No response to generate — close filler turn if open, then abort immediately.
      if (this.responseOutputTurnStarted) {
        this.responseOutputTurnStarted = false;
        if (this.stageData.ttsProvider) {
          await this.stageData.ttsProvider.end();
        }
      }
      this.pendingPostResponseAction = { name: executionOutcome.abortConversationSourceAction, type: 'abort_conversation', abortReason: executionOutcome.abortReason || 'Conversation aborted by action', context };
      await this.handlePostResponseAction();
    } else {
      // No response, no terminal action — close filler turn if open and return to idle.
      if (this.responseOutputTurnStarted) {
        this.responseOutputTurnStarted = false;
        if (this.stageData.ttsProvider) {
          await this.stageData.ttsProvider.end();
        }
      }
      await this.changeState('awaiting_user_input');
    }

    // Reset barge-in state after turn completes (success, failure, or exception).
    if (this.isBargeIn) {
      logger.info({ conversationId: this.stageData.conversation.id }, 'Barge-in turn completed, resetting barge-in state');
      this.isBargeIn = false;
      this.bargeInPartialText = null;
    }
  }

  /**
   * Executes any terminal action (end or abort) that was deferred until after the current
   * turn's response — including TTS audio — has been fully delivered to the client.
  * If no action is pending, transitions the conversation back to awaiting user input.
  * This method is idempotent: a second call after the action has already been consumed
  * is safe and will not overwrite a terminal state.
  */
  private async handlePostResponseAction(): Promise<void> {
    const action = this.pendingPostResponseAction;
    this.pendingPostResponseAction = null;

    if (!action) {
      // Guard against overwriting a terminal state (e.g. when onGenerationEnded fires
      // after a synchronous TTS provider already completed inline).
      if (this.conversation.status !== 'finished' && this.conversation.status !== 'failed') {
        if (this.ttsUsedInTurn) {
          this.waitingForPlaybackEnd = true;
        }
        await this.changeState('awaiting_user_input');
      }
      this.ttsUsedInTurn = false;
      return;
    }

    if (action.type === 'end_conversation') {
      const onConversationEndAction = this.conversationLifecycleActions.get(CONVERSATION_LIFECYCLE_ACTION_IDS.ON_END);
      if (onConversationEndAction) {
        logger.debug({ conversationId: this.conversation.id }, 'Executing __conversation_end lifecycle action');
        const endLifecycleOutcome = await this.actionsExecutor.executeActions([onConversationEndAction], action.context, this.stageData.id, 'conversation_end', this.saveAndSendEvent.bind(this));
        await this.applyActionOutcome(action.context, endLifecycleOutcome);
      }
      const eventData: ConversationEndEventData = { stageId: this.stageData.id, reason: action.endReason };
      await this.saveAndSendEvent('conversation_end', eventData);
      await this.changeState('finished');
    } else {
      const onConversationAbortAction = this.conversationLifecycleActions.get(CONVERSATION_LIFECYCLE_ACTION_IDS.ON_ABORT);
      if (onConversationAbortAction) {
        logger.debug({ conversationId: this.conversation.id }, 'Executing __conversation_abort lifecycle action');
        const abortLifecycleOutcome = await this.actionsExecutor.executeActions([onConversationAbortAction], action.context, this.stageData.id, 'conversation_abort', this.saveAndSendEvent.bind(this));
        await this.applyActionOutcome(action.context, abortLifecycleOutcome);
      }
      // Abort conversation without generating response
      const eventData: ConversationAbortedEventData = {
        stageId: this.stageData.id,
        reason: action.abortReason || 'Conversation aborted by action',
        sourceActionName: action.name,
      };
      await this.saveAndSendEvent('conversation_aborted', eventData);
      await this.changeState('finished');
    }
  }

  /**
   * Processes a resolved ModerationResult: updates timing metadata, emits the moderation event,
   * and handles blocked input by executing the `__moderation_blocked` global action (if configured).
   * @returns `null` when the turn has been fully handled and the caller must return,
   *          or the (possibly sanitised) `userInput` string to continue with.
   */
  private async handleModerationResult(
    moderationResult: ModerationResult,
    userInput: string,
    userInputSource: 'text' | 'voice',
  ): Promise<string | null> {
    this.turnData.moderationDurationMs = moderationResult.durationMs > 0 ? moderationResult.durationMs : null;
    this.turnData.moderationStartMs = moderationResult.durationMs > 0 ? moderationResult.startMs : null;
    this.turnData.moderationEndMs = this.turnData.moderationStartMs !== null ? this.turnData.moderationStartMs + moderationResult.durationMs : null;
    if (moderationResult.detectedCategories.length > 0) {
      const moderationEventData: ModerationEventData = { input: userInput, flagged: moderationResult.flagged, blockingCategories: moderationResult.blockingCategories, detectedCategories: moderationResult.detectedCategories, durationMs: moderationResult.durationMs, startMs: moderationResult.startMs, endMs: moderationResult.startMs + moderationResult.durationMs };
      await this.saveAndSendEvent('moderation', moderationEventData);
    }
    if (moderationResult.flagged) {
      logger.warn({ conversationId: this.conversation.id, categories: moderationResult.blockingCategories }, 'User input blocked by content moderation');
      logger.info({ globalActions: this.stageData.globalActions }, 'Checking for __moderation_blocked global action');
      const moderationBlockedAction = this.stageData.globalActions.find(ga => ga.id === '__moderation_blocked');
      if (moderationBlockedAction) {
        const context = await this.contextBuilder.buildContextForUserInput(this.stageData.conversation, this.stageData.stage, [], userInput, userInputSource, this.sampleCopyDistributor.getOriginalCopies(), '', '', this.stageData.faq, this.channel?.connectionType);
        const executionOutcome = await this.actionsExecutor.executeActions([moderationBlockedAction], context, this.stageData.id, null, this.saveAndSendEvent.bind(this));
        await this.applyActionOutcome(context, executionOutcome);
        const messageEventData: MessageEventData = {
          text: '[Content removed by moderation]',
          originalText: userInput,
          role: 'user',
          visibility: this.turnMessageVisibility,
          metadata: { moderationDurationMs: this.turnData.moderationDurationMs }
        };
        await this.saveAndSendEvent('message', messageEventData);
        await this.generateResponse(context, executionOutcome);
        return null;
      }
      // No moderation block action defined - sanitise input and carry on
      return '[Content removed by moderation]';
    }
    return userInput;
  }

  /**
   * Prepares the messages, rendered prompt, and token limits for a filler LLM call.
   * Returns null if filler is not configured.
   */
  private async prepareFillerMessages(userInput: string): Promise<{
    messages: LlmMessage[];
    renderedPrompt: string;
    maxTokens: number | undefined;
    truncationInfo: TruncationInfo;
  } | null> {
    const fillerLlmProvider = this.stageData.fillerLlmProvider;
    const fillerSettings = this.stageData.agent?.fillerSettings;
    if (!fillerLlmProvider || !fillerSettings) {
      return null;
    }
    const context = await this.contextBuilder.buildContextForFillerSentence(this.conversation, this.stageData.stage, userInput, this.channel?.connectionType);
    const renderedPrompt = await this.templatingEngine.render(fillerSettings.prompt, context);
    const historyMessageCount = fillerSettings.historyMessageCount ?? 0;
    let recentHistory = [...context.history];
    if (recentHistory.at(-1)?.role === 'user') {
      recentHistory.pop();
    }
    const historyMessages = historyMessageCount === 0 ? [] : historyMessageCount === -1 ? recentHistory : recentHistory.slice(-historyMessageCount);
    const fillerMessages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
      { role: 'system' as const, content: renderedPrompt },
      ...historyMessages.map(msg => ({ role: msg.role as 'user' | 'assistant', content: msg.content })),
      { role: 'user' as const, content: userInput },
    ];
    const fillerModel = this.stageData.agent?.fillerSettings?.llmSettings?.model;
    const fillerLimits = resolveProviderModelLimits(this.stageData.costManagementConfig, this.stageData.fillerLlmProviderInfo?.id ?? '', fillerModel);
    const fillerMaxTokens = resolveOutputCap((this.stageData.agent?.fillerSettings?.llmSettings as any)?.defaultMaxTokens, fillerLimits, 'filler');
    const fillerInputCap = fillerLimits?.inputTokensLimits?.filler;
    const { messages: truncatedFillerMessages, ...fillerTruncation } = truncateMessagesToTokenBudget(fillerMessages, fillerInputCap, fillerModel);

    return {
      messages: truncatedFillerMessages,
      renderedPrompt,
      maxTokens: fillerMaxTokens,
      truncationInfo: fillerTruncation,
    };
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
      const context = await this.contextBuilder.buildContextForFillerSentence(this.conversation, this.stageData.stage, userInput, this.channel?.connectionType);
      const renderedPrompt = await this.templatingEngine.render(fillerSettings.prompt, context);
      const historyMessageCount = fillerSettings.historyMessageCount ?? 0;
      // The current user message is already in context.history (saved to DB before context is built),
      // so remove it here to avoid sending it twice — it is appended explicitly below.
      let recentHistory = [...context.history];
      if (recentHistory.at(-1)?.role === 'user') {
        recentHistory.pop();
      }
      const historyMessages = historyMessageCount === 0 ? [] : historyMessageCount === -1 ? recentHistory : recentHistory.slice(-historyMessageCount);
      const fillerMessages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
        { role: 'system' as const, content: renderedPrompt },
        ...historyMessages.map(msg => ({ role: msg.role as 'user' | 'assistant', content: msg.content })),
        { role: 'user' as const, content: userInput },
      ];
      const fillerModel = this.stageData.agent?.fillerSettings?.llmSettings?.model;
      const fillerLimits = resolveProviderModelLimits(this.stageData.costManagementConfig, this.stageData.fillerLlmProviderInfo?.id ?? '', fillerModel);
      const fillerMaxTokens = resolveOutputCap((this.stageData.agent?.fillerSettings?.llmSettings as any)?.defaultMaxTokens, fillerLimits, 'filler');
      const fillerInputCap = fillerLimits?.inputTokensLimits?.filler;
      const { messages: truncatedFillerMessages, ...fillerTruncation } = truncateMessagesToTokenBudget(fillerMessages, fillerInputCap, fillerModel);
      logger.info({ conversationId: this.conversation.id, model: fillerModel, maxTokens: fillerMaxTokens, messageCount: truncatedFillerMessages.length }, 'Filler LLM payload');
      const result = await fillerLlmProvider.generate(truncatedFillerMessages, fillerMaxTokens !== undefined ? { maxTokens: fillerMaxTokens } : undefined);
      const text = extractTextFromContent(result.content).trim();
      if (text.length > 0) {
        this.lastFillerPrompt = renderedPrompt;
        this.turnData.fillerLlmUsage = buildLlmUsage(result.usage, this.stageData.fillerLlmProviderInfo, this.stageData.agent?.fillerSettings?.llmSettings?.model, fillerTruncation) ?? null;
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

    this.turnData.prescriptedText = text;
    const fillerPrefix = this.turnData.fillerSentence ? `${this.turnData.fillerSentence} ` : '';
    const eventText = `${fillerPrefix}${text}`.trim();

    if (ttsProvider) {
      this.ttsUsedInTurn = true;
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
      text: eventText,
      role: 'assistant',
      originalText: eventText,
      visibility: this.turnMessageVisibility,
      metadata: {
        prescripted: true,
        fillerSentence: this.turnData.fillerSentence ?? undefined,
      },
    };
    this.turnData.assistantMessageEventId = await this.saveAndSendEvent('message', messageEventData);

    if (!ttsProvider) {
      const prescriptedEndMessage: CALEndAiGenerationOutputMessage = {
        type: 'end_ai_generation_output',
        conversationId,
        outputTurnId: this.turnData.outputTurnId,
        fullText: eventText,
      };
      await this.channel.sendMessage(prescriptedEndMessage);
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



  private clearSilenceTimer(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  public notifyAudioPlaybackEnded(): void {
    if (!this.waitingForPlaybackEnd) return;
    this.waitingForPlaybackEnd = false;
    if (!this.isVadMode) return;
    const timeoutMs = this.stageData.project.asrConfig?.silenceTimeoutMs;
    if (timeoutMs && timeoutMs > 0) {
      this.silenceTimer = setTimeout(async () => {
        await this.handleUserSilence();
      }, timeoutMs);
    }
  }

  private async handleUserSilence(): Promise<void> {
    if (this.conversation.status !== 'awaiting_user_input') {
      return;
    }

    // Guard against session detachment: if the runner was detached, don't proceed.
    if (this.session.runner !== this) {
      logger.debug({ conversationId: this.conversation.id }, 'Silence timer fired but runner was detached, ignoring');
      return;
    }

    this.silenceCount++;
    const maxSilences = this.stageData.project.asrConfig?.maxSilences;

    if (maxSilences && maxSilences > 0 && this.silenceCount >= maxSilences) {
      logger.info({ conversationId: this.conversation.id, silenceCount: this.silenceCount }, 'Max silences reached, ending conversation');
      try {
        const onConversationEndAction = this.conversationLifecycleActions.get(CONVERSATION_LIFECYCLE_ACTION_IDS.ON_END);
        if (onConversationEndAction) {
          const endContext = await this.contextBuilder.buildContextForConversationStart(this.conversation, this.channel?.connectionType);
          await this.actionsExecutor.executeActions([onConversationEndAction], endContext, this.stageData.id, 'conversation_end', this.saveAndSendEvent.bind(this));
        }
        const eventData: ConversationEndEventData = { stageId: this.stageData.id, reason: 'Conversation ended due to prolonged user silence' };
        await this.saveAndSendEvent('conversation_end', eventData);
        await this.changeState('finished');
      } catch (error) {
        logger.error({ conversationId: this.conversation.id, error: error instanceof Error ? error.message : String(error) }, 'Failed to end conversation after max silences');
      }
      return;
    }

    logger.info({ conversationId: this.conversation.id, silenceCount: this.silenceCount }, 'User silence detected, triggering response');
    const placeholder = this.stageData.project.asrConfig?.silencePlaceholder ?? '[silence]';
    await this.receiveUserTextInput(placeholder);
  }

  private async changeState(newState: ConversationState) {
    this.conversation.status = newState;
    await this.conversationService.saveConversationState(this.conversation.projectId, this.conversation.id, newState);

    const TERMINAL_STATES = ['finished', 'aborted', 'failed'] as const;
    if (TERMINAL_STATES.includes(newState as (typeof TERMINAL_STATES)[number])) {
      await this.recorder?.flush();
      try {
        await this.session.clientConnection?.close();
      } catch (error) {
        logger.warn({ conversationId: this.conversation.id, error: error instanceof Error ? error.message : String(error) }, 'Failed to close client connection on terminal state');
      }
    }

    if (newState === 'awaiting_user_input') {
      this.clearSilenceTimer();
    } else {
      this.clearSilenceTimer();
      // Reset silence count only when user provides real voice input (not silence-triggered placeholder)
      if (newState === 'receiving_user_voice') {
        this.silenceCount = 0;
        this.turnData.inputTurnId = generateId(ID_PREFIXES.INPUT);
      }
    }

    if (newState === 'awaiting_user_input' && this.isVadMode && this.vadProcessor) {
      // During barge-in, skip VAD reset to keep speech tracking continuous through the
      // generation→awaiting transition. A mid-utterance pause would otherwise force VAD to
      // re-detect speech, losing audio that Azure never finalizes.
      if (!this.isBargeIn) {
        this.vadProcessor.reset();
      }
      // Pre-warm the next ASR session immediately so it is ready before VAD fires speech_start.
      // Audio only flows once state transitions to receiving_user_voice, so silence never reaches
      // the provider. If the session times out before the user speaks, setOnRecognitionStopped
      // detects the idle state and clears asrPreWarmPromise; handleVadSpeechStart then falls
      // back to a fresh start().
      if (this.stageData?.asrProvider) {
        this.asrPreWarmPromise = this.stageData.asrProvider.start().catch(err => {
          this.asrPreWarmPromise = null;
          logger.warn({ conversationId: this.conversation.id, error: err instanceof Error ? err.message : String(err) }, `ASR pre-warm failed for conversation ${this.conversation.id}`);
        });
      }
    }
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
    eventData.metadata['stageName'] = this.stageData.stage.name;

    const eventId = await this.conversationService.saveConversationEvent(this.conversation.projectId, this.conversation.id, eventType, eventData, this.stageData.id);
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
}
