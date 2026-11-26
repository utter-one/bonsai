import { inject, injectable } from 'tsyringe';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../../db';
import { conversations, globalActions, stages, users } from '../../db/schema';
import { CONVERSATION_LIFECYCLE_ACTION_IDS } from '../../types/actions';
import type { LifecycleContext } from '../../types/actions';
import type { Conversation, GlobalAction } from '../../types/models';
import type { ApiKeyChannel } from '../../apiKeyFeatures';
import { ActionsExecutor } from './ActionsExecutor';
import type { ActionsExecutionOutcome, EffectEventCallback } from './ActionsExecutor';
import { ConversationContext, ConversationContextBuilder } from './ConversationContextBuilder';
import { logger } from '../../utils/logger';

/**
 * Options for running a conversation-level lifecycle global action without a conversation runner.
 */
export type ConversationLifecycleActionOptions = {
  /** Project the conversation belongs to */
  projectId: string;
  /** Conversation the lifecycle action runs for */
  conversationId: string;
  /** In-memory conversation entity. When omitted the row is re-read; the runner passes its own copy so un-persisted stage vars stay visible. */
  conversation?: Conversation;
  /** Channel type used for context building. Undefined for conversations without a live connection. */
  channel?: ApiKeyChannel;
  /** Sink for events emitted while the action runs (execution plan, tool calls). Defaults to discarding them. */
  emitEvent?: EffectEventCallback;
  /** Caller-specific outcome handling. Defaults to persisting variable and user-profile changes only. */
  applyOutcome?: (context: ConversationContext, outcome: ActionsExecutionOutcome) => Promise<void>;
};

/**
 * Runs the reserved conversation-level lifecycle global actions (`__conversation_abort` and friends)
 * independently of a ConversationRunner.
 *
 * The runner owns the interactive turn loop, but it only exists while a client connection is
 * attached — a conversation abandoned by its client has no runner at all. Background jobs that
 * terminate such conversations (the inactivity-timeout sweeper) would otherwise skip the hook
 * entirely, so the loading, context building, execution and state persistence live here and are
 * shared with the runner, which supplies its own event sink and outcome handling.
 *
 * Lifecycle-effect restrictions (`LIFECYCLE_EFFECT_RESTRICTIONS`) are applied by `ActionsExecutor`.
 */
@injectable()
export class ConversationLifecycleActionService {
  constructor(
    @inject(ActionsExecutor) private readonly actionsExecutor: ActionsExecutor,
    @inject(ConversationContextBuilder) private readonly contextBuilder: ConversationContextBuilder,
  ) { }

  /**
   * Executes the project's `__conversation_abort` global action for a conversation that is about to
   * be terminated. Never throws: a failing or missing hook must never prevent the termination itself.
   * @returns true when the action existed and was executed
   */
  async executeAbortAction(options: ConversationLifecycleActionOptions): Promise<boolean> {
    return this.executeLifecycleAction(CONVERSATION_LIFECYCLE_ACTION_IDS.ON_ABORT, 'conversation_abort', options);
  }

  /**
   * Loads every defined conversation-level lifecycle global action of a project, keyed by reserved ID.
   */
  async loadConversationLifecycleActions(projectId: string): Promise<Map<string, GlobalAction>> {
    const rows = await db.query.globalActions.findMany({
      where: and(
        eq(globalActions.projectId, projectId),
        inArray(globalActions.id, Object.values(CONVERSATION_LIFECYCLE_ACTION_IDS)),
      ),
    });
    return new Map(rows.map((row) => [row.id, row as GlobalAction]));
  }

  private async executeLifecycleAction(
    actionId: string,
    lifecycleContext: LifecycleContext,
    options: ConversationLifecycleActionOptions,
  ): Promise<boolean> {
    const { projectId, conversationId } = options;
    const emitEvent = options.emitEvent ?? (async () => { });

    try {
      const conversation = await this.resolveConversation(options);
      if (!conversation) return false;

      const action = await this.loadLifecycleAction(projectId, actionId);
      if (!action) return false;

      const stage = await db.query.stages.findFirst({
        where: and(eq(stages.projectId, projectId), eq(stages.id, conversation.stageId)),
        with: { agent: true },
      });
      if (!stage) {
        logger.warn({ conversationId, projectId, stageId: conversation.stageId, lifecycleContext }, 'Cannot run lifecycle action: conversation stage no longer exists');
        return false;
      }

      const context = await this.contextBuilder.buildContextForLifecycleAction(conversation, stage, options.channel);
      const outcome = await this.actionsExecutor.executeActions([action], context, stage.id, lifecycleContext, emitEvent);

      if (!outcome.success) {
        logger.error({ conversationId, projectId, lifecycleContext, error: outcome.error }, 'Lifecycle action execution failed');
        return false;
      }

      if (options.applyOutcome) {
        await options.applyOutcome(context, outcome);
      } else {
        await this.persistOutcomeState(conversation, stage.id, context, outcome);
      }

      logger.info({ conversationId, projectId, stageId: stage.id, lifecycleContext, actionName: action.name }, 'Lifecycle action completed');
      return true;
    } catch (error) {
      logger.error({ error, conversationId, projectId, lifecycleContext }, 'Lifecycle action raised an unexpected error');
      return false;
    }
  }

  /** Returns the active conversation to run the action for, or null when it is missing or already terminal. */
  private async resolveConversation(options: ConversationLifecycleActionOptions): Promise<Conversation | null> {
    if (options.conversation) return options.conversation;

    const conversation = await db.query.conversations.findFirst({
      where: and(eq(conversations.projectId, options.projectId), eq(conversations.id, options.conversationId)),
    });
    if (!conversation) {
      logger.warn({ conversationId: options.conversationId, projectId: options.projectId }, 'Cannot run lifecycle action: conversation not found');
      return null;
    }
    if (conversation.status === 'finished' || conversation.status === 'failed' || conversation.status === 'aborted') {
      logger.debug({ conversationId: options.conversationId, status: conversation.status }, 'Conversation already terminal, skipping lifecycle action');
      return null;
    }
    return conversation as Conversation;
  }

  private async loadLifecycleAction(projectId: string, actionId: string): Promise<GlobalAction | null> {
    const row = await db.query.globalActions.findFirst({
      where: and(eq(globalActions.projectId, projectId), eq(globalActions.id, actionId)),
    });
    return (row as GlobalAction) ?? null;
  }

  /** Persists the state an action changed without a runner around it. Terminal state is the caller's responsibility. */
  private async persistOutcomeState(
    conversation: Conversation,
    stageId: string,
    context: ConversationContext,
    outcome: ActionsExecutionOutcome,
  ): Promise<void> {
    if (outcome.hasModifiedVars) {
      const stageVars = { ...(conversation.stageVars ?? {}), [stageId]: context.vars };
      await db.update(conversations)
        .set({ stageVars, updatedAt: new Date() })
        .where(and(eq(conversations.projectId, conversation.projectId), eq(conversations.id, conversation.id)));
    }

    if (outcome.hasModifiedUserProfile) {
      await db.update(users)
        .set({ profile: context.userProfile, updatedAt: new Date() })
        .where(and(eq(users.projectId, conversation.projectId), eq(users.id, conversation.userId)));
    }
  }
}
