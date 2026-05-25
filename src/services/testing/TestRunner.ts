import { injectable, inject, container } from 'tsyringe';
import { db } from '../../db/index';
import { providers } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { LlmProviderFactory } from '../providers/llm/LlmProviderFactory';
import type { ILlmProvider, LlmMessage } from '../providers/llm/ILlmProvider';
import { extractTextFromContent } from '../../utils/llm';
import { ConversationTerminatedError } from '../../errors';
import { TesterClientConnection } from './TesterClientConnection';
import type { TesterResponse } from '../../http/contracts/tester';
import type { ScenarioResponse } from '../../http/contracts/scenario';
import type { Session } from '../../channels/SessionManager';
import { logger } from '../../utils/logger';

/** Possible outcomes for a single test run conversation. */
export type TestRunStatus =
  | 'conversation_ended'
  | 'conversation_aborted'
  | 'conversation_failed'
  | 'max_turns_reached'
  | 'tester_hung_up';

/** Result returned after a single test run conversation completes. */
export type TestRunResult = {
  /** How the test conversation ended. */
  status: TestRunStatus;
  /** Number of tester turns that were sent during the conversation. */
  turnCount: number;
};

const TERMINAL_EVENT_STATUS_MAP: Record<string, TestRunStatus> = {
  conversation_end: 'conversation_ended',
  conversation_aborted: 'conversation_aborted',
  conversation_failed: 'conversation_failed',
};

/**
 * Executes a single automated test conversation.
 * Uses ConversationRunner for the AI side and an LLM-backed tester persona for the user side.
 * The caller is responsible for creating the Conversation entity and managing the
 * scenarioConversation DB record; TestRunner is purely the execution engine.
 */
@injectable()
export class TestRunner {
  constructor(@inject(LlmProviderFactory) private readonly llmProviderFactory: LlmProviderFactory) {}

  /**
   * Runs a single test conversation to completion.
   * @param conversationId - ID of an already-created Conversation entity
   * @param projectId - ID of the project the conversation belongs to
   * @param tester - Tester persona configuration
   * @param scenario - Scenario configuration controlling turn limits and hang-up behaviour
   * @returns The outcome and turn count for the completed conversation
   * @throws When tester LLM provider is not found or cannot be created
   */
  async run(conversationId: string, projectId: string, tester: TesterResponse, scenario: ScenarioResponse): Promise<TestRunResult> {
    const testerLlmProvider = await this.createTesterLlmProvider(tester);

    const connection = new TesterClientConnection();
    const session = this.buildSession(projectId, conversationId, connection);

    const { ConversationRunner } = await import('../live/ConversationRunner.js');
    const runner = container.resolve(ConversationRunner);
    session.runner = runner;

    let turnCount = 0;

    try {
      await runner.prepareConversation(conversationId, session, connection);
      await runner.startConversation();

      /** History from the tester's perspective: AI utterances are 'user', tester utterances are 'assistant'. */
      const history: LlmMessage[] = [];

      if (connection.hasPendingResponse()) {
        // AI already spoke before awaiting user input — drain the buffered response.
        const aiText = await connection.waitForAiResponse();
        history.push({ role: 'user', content: aiText });
      } else {
        // First stage awaits user input — send the configured opener (or a generic fallback)
        // so the conversation starts without needing the tester LLM to produce cold-start content.
        const opener = scenario.conversationOpener ?? '[Conversation begins.]';
        logger.info({ conversationId, opener }, 'TestRunner: sending conversation opener');
        history.push({ role: 'assistant', content: opener });
        turnCount++;
        await runner.receiveUserTextInput(opener);
        const aiText = await connection.waitForAiResponse();
        history.push({ role: 'user', content: aiText });
      }

      while (true) {
        if (turnCount >= scenario.maxTurns) {
          logger.info({ conversationId, turnCount }, 'TestRunner: max turns reached, ending conversation');
          await runner.executeEndLifecycleAction();
          return { status: 'max_turns_reached', turnCount };
        }

        const testerText = await this.callTesterLlm(testerLlmProvider, tester, history);

        if (scenario.personaCanHangUp && tester.hangUpPrompt) {
          const shouldHangUp = await this.callHangUpLlm(testerLlmProvider, tester, history);
          if (shouldHangUp) {
            logger.info({ conversationId, turnCount }, 'TestRunner: tester chose to hang up');
            await runner.executeEndLifecycleAction();
            return { status: 'tester_hung_up', turnCount };
          }
        }

        history.push({ role: 'assistant', content: testerText });
        turnCount++;

        await runner.receiveUserTextInput(testerText);
        const aiText = await connection.waitForAiResponse();
        history.push({ role: 'user', content: aiText });
      }
    } catch (error) {
      if (error instanceof ConversationTerminatedError) {
        const status = TERMINAL_EVENT_STATUS_MAP[error.terminalEvent] ?? 'conversation_failed';
        return { status, turnCount };
      }
      throw error;
    } finally {
      await runner.cleanup();
      await testerLlmProvider.cleanup();
    }
  }

  /**
   * Calls the tester LLM to generate the next user response.
   * @param provider - Initialised LLM provider for the tester
   * @param tester - Tester persona with the system prompt
   * @param history - Conversation history from the tester's perspective
   * @returns The tester's next response text
   */
  private async callTesterLlm(provider: ILlmProvider, tester: TesterResponse, history: LlmMessage[]): Promise<string> {
    const messages: LlmMessage[] = [{ role: 'system', content: tester.prompt }, ...history];
    const result = await provider.generate(messages);
    return extractTextFromContent(result.content).trim();
  }

  /**
   * Calls the tester LLM with the hang-up prompt to decide whether the tester should end the conversation.
   * @param provider - Initialised LLM provider for the tester
   * @param tester - Tester persona with the hang-up prompt
   * @param history - Conversation history from the tester's perspective
   * @returns True if the tester should hang up, false otherwise
   */
  private async callHangUpLlm(provider: ILlmProvider, tester: TesterResponse, history: LlmMessage[]): Promise<boolean> {
    const messages: LlmMessage[] = [{ role: 'system', content: tester.hangUpPrompt! }, ...history];
    const result = await provider.generate(messages);
    const text = extractTextFromContent(result.content).trim().toLowerCase();
    return text.startsWith('yes') || text === 'true' || text === '1';
  }

  /**
   * Creates and initialises an LLM provider instance for the tester persona.
   * @param tester - Tester persona configuration containing provider ID and settings
   * @returns Initialised ILlmProvider ready for generation
   * @throws {Error} When llmProviderId is missing or the provider entity is not found
   */
  private async createTesterLlmProvider(tester: TesterResponse): Promise<ILlmProvider> {
    if (!tester.llmProviderId) {
      throw new Error(`Tester ${tester.id} has no llmProviderId configured`);
    }

    const providerEntity = await db.query.providers.findFirst({ where: eq(providers.id, tester.llmProviderId) });
    if (!providerEntity) {
      throw new Error(`LLM provider ${tester.llmProviderId} not found for tester ${tester.id}`);
    }

    return this.llmProviderFactory.createProvider(providerEntity, tester.llmSettings);
  }

  /**
   * Builds a minimal Session object for use with ConversationRunner in a testing context.
   * Voice input and output are disabled; only text interaction is used.
   * @param projectId - Project ID for the session
   * @param conversationId - Conversation ID to associate with the session
   * @param connection - TesterClientConnection for capturing AI responses
   * @returns A Session object suitable for passing to ConversationRunner
   */
  private buildSession(projectId: string, conversationId: string, connection: TesterClientConnection): Session {
    return {
      id: `test_session_${conversationId}`,
      projectId,
      conversationId,
      runner: null as never,
      clientConnection: connection,
      sessionSettings: {
        sendVoiceInput: false,
        sendTextInput: true,
        receiveVoiceOutput: false,
        receiveTranscriptionUpdates: false,
        receiveEvents: true,
        sendAudioFormat: 'pcm_16000',
        receiveAudioFormat: 'pcm_16000',
      },
      keySettings: null,
    };
  }
}
