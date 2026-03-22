import { and, asc, eq, param } from "drizzle-orm";
import { conversationEvents, db, projects, stages, users } from "../../db";
import { Session } from "../../channels/SessionManager";
import { inject, singleton } from "tsyringe";
import { Conversation, GlobalAction, Guardrail, Stage } from "../../types/models";
import { FieldDescriptor } from "../../types/parameters";
import { StageAction } from "../../types/actions";
import { ConversationEventData } from "../../types/conversationEvents";
import { IsolatedScriptExecutor } from "./IsolatedScriptExecutor";
import { HistoryBuilder } from "./HistoryBuilder";
import { isActionActive } from "../../utils/actions";
import { ActionClassificationResult } from "../../types/classification";
import type { KnowledgeCategoryResponse } from "../../http/contracts/knowledge";
import type { TimeContext, CalendarDay } from "../../types/TimeContext";

/**
 * Recursively converts a single FieldDescriptor into a pseudo-JSON value.
 * Primitives become their type label string (e.g. "string"), arrays are wrapped in a
 * single-element array, and objects are expanded into key→value maps.
 */
function buildSchemaValue(descriptor: FieldDescriptor): unknown {
  if (descriptor.objectSchema?.length) {
    const obj: Record<string, unknown> = {};
    for (const child of descriptor.objectSchema) {
      obj[child.name] = buildSchemaValue(child);
    }
    return descriptor.isArray ? [obj] : obj;
  }
  // Strip trailing [] from type name — isArray already controls the array wrapper
  const typeName = descriptor.type.replace(/\[\]$/, '');
  return descriptor.isArray ? [typeName] : typeName;
}

/**
 * Converts an array of FieldDescriptors into a pseudo-JSON string that shows field names,
 * types, array shapes and nested object structures. Intended for inclusion in LLM prompts.
 *
 * Example output:
 * ```json
 * {
 *   "name": "string",
 *   "age": "number",
 *   "tags": ["string"],
 *   "address": {
 *     "street": "string",
 *     "city": "string"
 *   },
 *   "contacts": [{ "name": "string" }]
 * }
 * ```
 */
function fieldDescriptorsToPseudoJson(descriptors: FieldDescriptor[]): string {
  if (!descriptors.length) return '{}';
  const obj: Record<string, unknown> = {};
  for (const d of descriptors) {
    obj[d.name] = buildSchemaValue(d);
  }
  return JSON.stringify(obj, null, 2);
}

/**
 * A single FAQ item consisting of a question and its answer, sourced from the knowledge base.
 */
export type FaqItem = {
  question: string;
  answer: string;
};

/**
 * A single conversation event entry exposed to the script sandbox.
 * Contains all event types in chronological order, including messages.
 */
export type ScriptEvent = {
  /** Unique event ID */
  id: string;
  /** Event type discriminator */
  eventType: string;
  /** ISO 8601 timestamp of when the event occurred */
  timestamp: string;
  /** Event-specific data payload */
  eventData: ConversationEventData;
  /** Optional metadata */
  metadata?: Record<string, any>;
};

export type ConversationContext = {
  /** ID of the conversation */
  conversationId: string;

  /** ID of the project the conversation belongs to */
  projectId: string;

  /** Stage variables */
  vars: Record<string, any>;

  /** Full stage variables for referencing in other stages */
  stageVars?: Record<string, Record<string, any>>; 

  /** User profile data */
  userProfile: Record<string, any>;

  /** Project-level constants available in all prompts via {{consts.key}} */
  consts: Record<string, any>;

  /** Agent prompt that defines AI personality and behavior */
  agent?: string;

  /** Conversation history as an array of messages */
  history: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;

  /**
   * All conversation events in chronological order, including messages, actions, stage transitions, etc.
   * Available in scripts as `events`. Use `history` for a pre-filtered view of message events only.
   */
  events: ScriptEvent[];

  /** Explicitly called or detected actions */
  actions: Record<string, {
    parameters: Record<string, any>
  }>;

  /** User input that triggered processing (can be null if not triggered by user input) */
  userInput?: string;

  /** Source of the user input (e.g., 'text' or 'voice') */
  userInputSource?: 'text' | 'voice';

  /** The original user input before any action processing/redaction/etc. */
  originalUserInput?: string;

  /** Results from webhooks and tools called during processing */
  results: {
    webhooks: Record<string, any>;
    tools: Record<string, any>;
  }

  /** FAQ items gathered from knowledge base categories triggered during this conversation turn */
  faq?: FaqItem[];

  /**
   * Pseudo-JSON schema descriptions of context variables, populated for transformer contexts.
   */
  schema?: string;

  /**
   * Current values of the stage variable fields selected for transformation.
   * Only populated in transformer contexts. Use the `json` helper in templates to render it.
   */
  context?: Record<string, any>;

  /**
   * Time context for the conversation, anchored to the conversation's resolved timezone.
   * Use `{{time.anchor}}` in prompts to ground the LLM in the current date/time.
   * Use `{{time.nextTuesday}}`, `{{time.calendar}}`, etc. for relative date references.
   */
  time: TimeContext;

  /** Project-level settings exposed in conversation context */
  project: {
    /** IANA timezone identifier configured on the project, e.g. "Europe/Warsaw". Null if not set. */
    timezone: string | null;
    /** ISO language code configured on the project, e.g. "en-US" or "pl-PL". Null if not set. */
    languageCode: string | null;
    /** Human-readable language name derived from languageCode, e.g. "American English". Null if languageCode is not set. */
    language: string | null;
  };

  /** Stage configuration and available actions (optional, included for classification and processing contexts) */
  stage?: {
    /** ID of the stage */
    id: string;
    /** Display name of the stage */
    name: string;
    /** List of actions available in this stage that can be triggered by user input */
    availableActions: Array<{
      name: string;
      trigger: string;
      examples?: string[];
      parameters?: Array<{
        name: string;
        type: string;
        description: string;
        required: boolean;
      }>;
    }>;
    /** Whether knowledge base is active */
    useKnowledge: boolean;
    /** Behavior when entering stage */
    enterBehavior: 'generate_response' | 'await_user_input';
    /** Custom stage metadata */
    metadata?: Record<string, any>;
  };
}

/**
 * Builder for LLM context used in live sessions. Contains all necessary data that can be used by LLMs in prompts.
 * The context is used by templating engine to create final prompts sent to LLMs.
 */
@singleton()
export class ConversationContextBuilder {
  constructor(
    @inject(IsolatedScriptExecutor) private readonly scriptExecutor: IsolatedScriptExecutor,
    @inject(HistoryBuilder) private readonly historyBuilder: HistoryBuilder,
  ) {}

  /**
   * Builds a rich time context object anchored to the given IANA timezone.
   * Uses only the native `Intl.DateTimeFormat` API — no external dependencies.
   * @param timezone - IANA timezone identifier, e.g. "Europe/Warsaw". Defaults to "UTC".
   */
  private buildTimeContext(timezone: string = 'UTC'): TimeContext {
    const now = new Date();
    const ts = now.getTime();

    // Extract individual date/time components in the target timezone
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(now);

    const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';

    const year = get('year');
    const month = get('month').padStart(2, '0');
    const day = get('day').padStart(2, '0');
    // Intl may return "24" for midnight — normalise to "00"
    const hour = (get('hour') === '24' ? '00' : get('hour')).padStart(2, '0');
    const minute = get('minute').padStart(2, '0');
    const second = get('second').padStart(2, '0');

    const date = `${year}-${month}-${day}`;
    const time = `${hour}:${minute}:${second}`;
    const dateTime = `${date} ${time}`;

    const monthName = new Intl.DateTimeFormat('en-US', { timeZone: timezone, month: 'long' }).format(now);
    const monthNameShort = new Intl.DateTimeFormat('en-US', { timeZone: timezone, month: 'short' }).format(now);
    const dayOfWeek = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'long' }).format(now);
    const dayOfWeekShort = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(now);

    // Compute UTC offset by comparing TZ-local clock to UTC clock via toLocaleString
    const utcDate = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
    const tzDate = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
    const diffMinutes = Math.round((tzDate.getTime() - utcDate.getTime()) / 60000);
    const offsetSign = diffMinutes >= 0 ? '+' : '-';
    const absMinutes = Math.abs(diffMinutes);
    const offsetHours = String(Math.floor(absMinutes / 60)).padStart(2, '0');
    const offsetMins = String(absMinutes % 60).padStart(2, '0');
    const offset = `${offsetSign}${offsetHours}:${offsetMins}`;

    const iso = `${date}T${time}.000${offset}`;

    // Weekday index of today (0=Sunday … 6=Saturday)
    const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const todayDowIndex = weekdays.indexOf(dayOfWeek);

    // Helper: add N days to date string (YYYY-MM-DD) using UTC arithmetic
    const addDays = (dateStr: string, n: number): string => {
      const [y, m, d] = dateStr.split('-').map(Number);
      const base = new Date(Date.UTC(y, m - 1, d));
      base.setUTCDate(base.getUTCDate() + n);
      return [
        base.getUTCFullYear(),
        String(base.getUTCMonth() + 1).padStart(2, '0'),
        String(base.getUTCDate()).padStart(2, '0'),
      ].join('-');
    };

    // Next occurrence of each weekday (returns today if today matches)
    const nextWeekday = (targetIndex: number): string => {
      let daysAhead = targetIndex - todayDowIndex;
      if (daysAhead < 0) daysAhead += 7;
      return addDays(date, daysAhead);
    };

    const nextSunday    = nextWeekday(0);
    const nextMonday    = nextWeekday(1);
    const nextTuesday   = nextWeekday(2);
    const nextWednesday = nextWeekday(3);
    const nextThursday  = nextWeekday(4);
    const nextFriday    = nextWeekday(5);
    const nextSaturday  = nextWeekday(6);

    // Upcoming 14-day calendar window
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const weekdaysShort = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const calendar: CalendarDay[] = [];
    for (let i = 0; i < 14; i++) {
      const calDate = addDays(date, i);
      const [cy, cm, cd] = calDate.split('-').map(Number);
      const dowIndex = new Date(Date.UTC(cy, cm - 1, cd)).getUTCDay();
      calendar.push({
        date: calDate,
        dayName: weekdays[dowIndex],
        dayNameShort: weekdaysShort[dowIndex],
        month: monthNames[cm - 1],
        dayOfMonth: cd,
        isToday: i === 0,
      });
    }

    // Compute Mon–Sun boundaries for this week and next week
    const daysToThisMonday = todayDowIndex === 0 ? -6 : 1 - todayDowIndex;
    const thisMonday = addDays(date, daysToThisMonday);
    const thisSunday = addDays(thisMonday, 6);
    const nextWeekMonday = addDays(thisMonday, 7);
    const nextWeekSunday = addDays(thisMonday, 13);

    const shortLabel = (dateStr: string): string => {
      const [, m, d] = dateStr.split('-').map(Number);
      return `${d} ${monthNames[m - 1].substring(0, 3)}`;
    };

    const anchor = [
      `Today is ${dayOfWeek}, ${parseInt(day)} ${monthName} ${year} (${timezone}, UTC${offset}).`,
      `This week (Mon–Sun): ${shortLabel(thisMonday)}–${shortLabel(thisSunday)}.`,
      `Next week: ${shortLabel(nextWeekMonday)}–${shortLabel(nextWeekSunday)}.`,
      `Next Mon: ${shortLabel(nextMonday)}, Tue: ${shortLabel(nextTuesday)}, Wed: ${shortLabel(nextWednesday)}, Thu: ${shortLabel(nextThursday)}, Fri: ${shortLabel(nextFriday)}, Sat: ${shortLabel(nextSaturday)}, Sun: ${shortLabel(nextSunday)}.`,
    ].join(' ');

    return {
      iso, timestamp: ts, date, time, dateTime,
      year, month, day, hour, minute, second,
      monthName, monthNameShort, dayOfWeek, dayOfWeekShort,
      timezone, offset,
      nextMonday, nextTuesday, nextWednesday, nextThursday, nextFriday, nextSaturday, nextSunday,
      calendar,
      anchor,
    };
  }

  /**
   * Builds a project context object from raw project settings.
   * Derives `language` as the human-readable English name of the ISO language code.
   * @param timezone - IANA timezone identifier, e.g. "Europe/Warsaw". Null if not set.
   * @param languageCode - ISO language code, e.g. "en-US" or "pl-PL". Null if not set.
   */
  private buildProjectContext(timezone: string | null, languageCode: string | null): ConversationContext['project'] {
    let language: string | null = null;
    if (languageCode) {
      try {
        language = new Intl.DisplayNames(['en'], { type: 'language' }).of(languageCode) ?? null;
      } catch {
        language = null;
      }
    }
    return { timezone, languageCode, language };
  }

  /**
   * Transforms Stage entity into simplified stage context for use in prompts.
   * Filters actions to only include those that can be triggered by user input.
   */
  private async buildStageContext(stage: Stage, rawContext: ConversationContext): Promise<ConversationContext['stage']> {
    const availableActions = Object.entries(stage.actions || {})
      .filter(async ([_, action]) => action.triggerOnUserInput && await isActionActive(action, rawContext, this.scriptExecutor))
      .map(([_, action]) => ({
        name: action.name,
        trigger: action.classificationTrigger,
        examples: action.examples || undefined,
        parameters: action.parameters?.map(p => ({
          name: p.name,
          type: p.type,
          description: p.description,
          required: p.required,
        })),
      }));

    return {
      id: stage.id,
      name: stage.name,
      availableActions,
      useKnowledge: stage.useKnowledge,
      enterBehavior: stage.enterBehavior,
      metadata: stage.metadata || undefined,
    };
  }

  /**
   * Transforms Stage entity into simplified stage context for a specific classifier.
   * Filters actions to only include those that can be triggered by user input, are assigned to this classifier or have no classifier assignment, and have truthy conditions.
   * @param stage - Stage entity
   * @param globalActions - Array of global actions for the stage
   * @param classifierId - ID of the classifier to filter actions for
   * @param rawContext - The conversation context to use for condition evaluation
   * @param knowledgeCategories - Optional knowledge categories to inject as synthetic actions (only for the default classifier)
   */
  private async buildStageContextForClassifier(stage: Stage, globalActions: GlobalAction[], classifierId: string, rawContext: ConversationContext, knowledgeCategories?: KnowledgeCategoryResponse[]) {
    // Filter stage actions: include if triggerOnUserInput is true AND (overrideClassifierId is null OR matches classifierId) AND condition is met
    const stageActionEntries = Object.entries(stage.actions || {})
      .filter(([_, action]) => action.triggerOnUserInput && (!action.overrideClassifierId || action.overrideClassifierId === classifierId));
    
    const stageActionsPromises = stageActionEntries.map(async ([id, action]) => {
      const isActive = await isActionActive(action, rawContext, this.scriptExecutor);
      if (!isActive) return null;
      
      return {
        name: action.name,
        trigger: action.classificationTrigger,
        examples: action.examples || undefined,
        parameters: action.parameters?.map(p => ({
          name: p.name,
          type: p.type,
          description: p.description,
          required: p.required,
        })),
      };
    });

    // Filter global actions: include if triggerOnUserInput is true AND (overrideClassifierId is null OR matches classifierId) AND condition is met
    const filteredGlobalActionsPromises = globalActions
      .filter(action => action.triggerOnUserInput && (!action.overrideClassifierId || action.overrideClassifierId === classifierId))
      .map(async action => {
        const isActive = await isActionActive(action, rawContext, this.scriptExecutor);
        if (!isActive) return null;
        
        return {
          name: action.name,
          trigger: action.classificationTrigger,
          examples: action.examples || undefined,
          parameters: action.parameters?.map(p => ({
            name: p.name,
            type: p.type,
            description: p.description,
            required: p.required,
          })),
        };
      });

    // Wait for all condition checks to complete
    const [stageActionsWithNulls, globalActionsWithNulls] = await Promise.all([
      Promise.all(stageActionsPromises),
      Promise.all(filteredGlobalActionsPromises)
    ]);

    // Filter out null values from actions that failed condition checks
    const stageActions = stageActionsWithNulls.filter(a => a !== null);
    const filteredGlobalActions = globalActionsWithNulls.filter(a => a !== null);

    // Build synthetic knowledge actions from knowledge categories (injected only for the default classifier)
    const knowledgeActions = (knowledgeCategories ?? []).map(category => ({
      name: `__knowledge_${category.id}`,
      trigger: category.promptTrigger,
    }));

    // Combine stage actions, global actions, and knowledge actions
    const availableActions = [...stageActions, ...filteredGlobalActions, ...knowledgeActions];

    return {
      id: stage.id,
      name: stage.name,
      availableActions,
      useKnowledge: stage.useKnowledge,
      enterBehavior: stage.enterBehavior,
      metadata: stage.metadata || undefined,
    };
  }

  /**
   * Builds the conversation context for a specific action being triggered, including only the relevant action in the context.
   *
   * @param conversation - Conversation entity
   * @param action - The action being triggered
   * @param parameters - Parameters for the triggered action
   */
  async buildContextForAction(conversation: Conversation, actionName: string, action: StageAction | GlobalAction, parameters: Record<string, any>): Promise<ConversationContext> {
    // Load user data
    const user = await db.query.users.findFirst({
      where: and(eq(users.projectId, conversation.projectId), eq(users.id, conversation.userId)),
    });

    // Load stage with agent
    const stage = await db.query.stages.findFirst({
      where: and(eq(stages.projectId, conversation.projectId), eq(stages.id, conversation.stageId)),
      with: { agent: true },
    });

    // Load project constants
    const project = await db.query.projects.findFirst({
      where: eq(projects.id, conversation.projectId),
      columns: { constants: true, timezone: true, languageCode: true },
    });

    const context = {
      conversationId: conversation.id,
      projectId: conversation.projectId,
      stageId: conversation.stageId,
      vars: conversation.stageVars[conversation.stageId] || {},
      stageVars: conversation.stageVars,
      userProfile: user?.profile || {},
      consts: project?.constants || {},
      agent: stage?.agent?.prompt,
      history: [],
      events: [],
      actions: {
        [actionName]: { parameters },
      },
      results: {
        webhooks: {},
        tools: {},
      },
      time: this.buildTimeContext((conversation.metadata?.timezone as string | undefined) ?? 'UTC'),
      project: this.buildProjectContext(project?.timezone ?? null, project?.languageCode ?? null),
      stage: await this.buildStageContext(stage, this.buildRawContext(conversation, stage!, user?.profile || {}, project?.constants || {}, this.buildProjectContext(project?.timezone ?? null, project?.languageCode ?? null))),
    };

    // Get all events from database; history is a filtered view on message events
    const allEvents = await db.query.conversationEvents.findMany({
      where: and(eq(conversationEvents.projectId, conversation.projectId), eq(conversationEvents.conversationId, conversation.id)),
      orderBy: asc(conversationEvents.timestamp),
    });
    context.events = allEvents.map(e => ({
      id: e.id,
      eventType: e.eventType,
      timestamp: e.timestamp.toISOString(),
      eventData: e.eventData as ConversationEventData,
      metadata: e.metadata as Record<string, any> | undefined,
    }));
    context.history = await this.historyBuilder.buildHistory(context.events, context);

    return context;
  }

  /**
   * Builds a lightweight context for filler sentence prompt template rendering.
   * Includes user input, vars, user profile, constants, conversation history, and time.
   * Does not include actions or FAQ since classification has not run yet at filler generation time.
   *
   * @param conversation - Conversation entity
   * @param stage - Current stage entity
   * @param userInput - The raw user input that triggered the filler
   * @returns ConversationContext suitable for rendering filler sentence prompt templates
   */
  async buildContextForFillerSentence(conversation: Conversation, stage: Stage, userInput: string): Promise<ConversationContext> {
    // Load user data
    const user = await db.query.users.findFirst({
      where: and(eq(users.projectId, conversation.projectId), eq(users.id, conversation.userId)),
    });

    // Load project constants
    const project = await db.query.projects.findFirst({
      where: eq(projects.id, conversation.projectId),
      columns: { constants: true, timezone: true, languageCode: true },
    });

    const context: ConversationContext = {
      conversationId: conversation.id,
      projectId: conversation.projectId,
      vars: conversation.stageVars[conversation.stageId] || {},
      stageVars: conversation.stageVars,
      userProfile: user?.profile || {},
      consts: project?.constants || {},
      agent: (stage as any).agent?.prompt,
      history: [],
      events: [],
      actions: {},
      userInput,
      results: {
        webhooks: {},
        tools: {},
      },
      time: this.buildTimeContext((conversation.metadata?.timezone as string | undefined) ?? 'UTC'),
      project: this.buildProjectContext(project?.timezone ?? null, project?.languageCode ?? null),
      stage: await this.buildStageContext(stage, this.buildRawContext(conversation, stage, user?.profile || {}, project?.constants || {}, this.buildProjectContext(project?.timezone ?? null, project?.languageCode ?? null))),
    };

    // Load conversation history so templates can reference prior messages
    const allEvents = await db.query.conversationEvents.findMany({
      where: and(eq(conversationEvents.projectId, conversation.projectId), eq(conversationEvents.conversationId, conversation.id)),
      orderBy: asc(conversationEvents.timestamp),
    });
    context.events = allEvents.map(e => ({
      id: e.id,
      eventType: e.eventType,
      timestamp: e.timestamp.toISOString(),
      eventData: e.eventData as ConversationEventData,
      metadata: e.metadata as Record<string, any> | undefined,
    }));
    context.history = await this.historyBuilder.buildHistory(context.events, context);

    return context;
  }

  /**
   * Builds the initial conversation context when a conversation starts, without any user input.
   * This context will not include any actions or history, but will include stage variables, user profile, and agent.
   * 
   * @param conversation - Conversation entity
   */
  async buildContextForConversationStart(conversation: Conversation): Promise<ConversationContext> {
    // Load stage with agent
    const stage = await db.query.stages.findFirst({
      where: and(eq(stages.projectId, conversation.projectId), eq(stages.id, conversation.stageId)),
      with: { agent: true },
    });

    const user = await db.query.users.findFirst({
      where: and(eq(users.projectId, conversation.projectId), eq(users.id, conversation.userId)),
    });

    // Load project constants
    const project = await db.query.projects.findFirst({
      where: eq(projects.id, conversation.projectId),
      columns: { constants: true, timezone: true, languageCode: true },
    });

    const context: ConversationContext = {
      conversationId: conversation.id,
      projectId: conversation.projectId,
      vars: conversation.stageVars[conversation.stageId] || {},
      stageVars: conversation.stageVars,
      userProfile: user?.profile || {},
      consts: project?.constants || {},
      agent: stage?.agent?.prompt,
      history: [],
      events: [],
      actions: {},
      results: {
        webhooks: {},
        tools: {},
      },
      time: this.buildTimeContext((conversation.metadata?.timezone as string | undefined) ?? 'UTC'),
      project: this.buildProjectContext(project?.timezone ?? null, project?.languageCode ?? null),
      stage: await this.buildStageContext(stage!, this.buildRawContext(conversation, stage!, user?.profile || {}, project?.constants || {}, this.buildProjectContext(project?.timezone ?? null, project?.languageCode ?? null))),
    };

    return context;
  }
  
  /**
   * Builds context specifically for a classifier with filtered actions.
   * Only includes actions that are either not assigned to any classifier or assigned to the specific classifier.
   * @param conversation - Conversation entity
   * @param stage - Stage entity with agent relation
   * @param globalActions - Array of global actions for the stage
   * @param classifierId - ID of the classifier to build context for
   * @param userInput - The user input text
   * @param originalUserInput - The original user input before any transformations
   * @param knowledgeCategories - Optional knowledge categories to inject as synthetic actions for this classifier
   */
  async buildContextForClassifier(conversation: Conversation, stage: Stage, globalActions: GlobalAction[], classifierId: string, userInput?: string, originalUserInput?: string, knowledgeCategories?: KnowledgeCategoryResponse[]): Promise<ConversationContext> {
    // Load user data
    const user = await db.query.users.findFirst({
      where: and(eq(users.projectId, conversation.projectId), eq(users.id, conversation.userId)),
    });

    // Load project constants
    const project = await db.query.projects.findFirst({
      where: eq(projects.id, conversation.projectId),
      columns: { constants: true, timezone: true, languageCode: true },
    });

    // Build raw context for condition evaluation
    const rawContext = this.buildRawContext(conversation, stage, user?.profile || {}, project?.constants || {}, this.buildProjectContext(project?.timezone ?? null, project?.languageCode ?? null));
    rawContext.userInput = userInput;
    rawContext.originalUserInput = originalUserInput;

    const context = {
      conversationId: conversation.id,
      projectId: conversation.projectId,
      vars: conversation.stageVars[conversation.stageId] || {},
      stageVars: conversation.stageVars,
      userProfile: user?.profile || {},
      consts: project?.constants || {},
      agent: (stage as any).agent?.prompt,
      history: [],
      events: [],
      actions: {}, // Convert classification results to actions later
      userInput,
      originalUserInput,
      results: {
        webhooks: {},
        tools: {},
      },
      time: this.buildTimeContext((conversation.metadata?.timezone as string | undefined) ?? 'UTC'),
      project: this.buildProjectContext(project?.timezone ?? null, project?.languageCode ?? null),
      stage: await this.buildStageContextForClassifier(stage, globalActions, classifierId, rawContext, knowledgeCategories),
    };

    // Get all events from database; history is a filtered view on message events
    const allEvents = await db.query.conversationEvents.findMany({
      where: and(eq(conversationEvents.projectId, conversation.projectId), eq(conversationEvents.conversationId, conversation.id)),
      orderBy: asc(conversationEvents.timestamp),
    });
    context.events = allEvents.map(e => ({
      id: e.id,
      eventType: e.eventType,
      timestamp: e.timestamp.toISOString(),
      eventData: e.eventData as ConversationEventData,
      metadata: e.metadata as Record<string, any> | undefined,
    }));
    context.history = await this.historyBuilder.buildHistory(context.events, context);

    return context;
  }

  /**
   * Builds the conversation context for the project-level guardrail classifier.
   * Unlike the regular classifier context, only guardrail actions are included — no stage actions,
   * no regular global actions, no knowledge categories, and no overrideClassifierId filtering
   * (guardrails do not have per-action classifier overrides).
   * @param conversation - Conversation entity
   * @param stage - Stage entity
   * @param guardrails - All project guardrails to evaluate
   * @param userInput - The user input text
   * @param originalUserInput - The original user input before any transformations
   */
  async buildContextForGuardrailClassifier(conversation: Conversation, stage: Stage, guardrails: Guardrail[], userInput?: string, originalUserInput?: string): Promise<ConversationContext> {
    // Load user data
    const user = await db.query.users.findFirst({
      where: and(eq(users.projectId, conversation.projectId), eq(users.id, conversation.userId)),
    });

    // Load project constants
    const project = await db.query.projects.findFirst({
      where: eq(projects.id, conversation.projectId),
      columns: { constants: true, timezone: true, languageCode: true },
    });

    // Build raw context for condition evaluation
    const rawContext = this.buildRawContext(conversation, stage, user?.profile || {}, project?.constants || {}, this.buildProjectContext(project?.timezone ?? null, project?.languageCode ?? null));
    rawContext.userInput = userInput;
    rawContext.originalUserInput = originalUserInput;

    // Evaluate active guardrails and map to available actions
    const guardrailActionPromises = guardrails.map(async (guardrail) => {
      const isActive = await isActionActive(guardrail, rawContext, this.scriptExecutor);
      if (!isActive) return null;
      return {
        id: guardrail.id,
        name: guardrail.name,
        trigger: guardrail.classificationTrigger,
        examples: guardrail.examples || undefined,
      };
    });
    const guardrailActionsWithNulls = await Promise.all(guardrailActionPromises);
    const availableActions = guardrailActionsWithNulls.filter(a => a !== null);

    const context = {
      conversationId: conversation.id,
      projectId: conversation.projectId,
      vars: conversation.stageVars[conversation.stageId] || {},
      stageVars: conversation.stageVars,
      userProfile: user?.profile || {},
      consts: project?.constants || {},
      agent: (stage as any).agent?.prompt,
      history: [],
      events: [],
      actions: {},
      userInput,
      originalUserInput,
      results: {
        webhooks: {},
        tools: {},
      },
      time: this.buildTimeContext((conversation.metadata?.timezone as string | undefined) ?? 'UTC'),
      project: this.buildProjectContext(project?.timezone ?? null, project?.languageCode ?? null),
      stage: {
        id: stage.id,
        name: stage.name,
        availableActions,
        useKnowledge: false,
        enterBehavior: stage.enterBehavior,
        metadata: stage.metadata || undefined,
      },
    };

    // Get all events from database; history is a filtered view on message events
    const allEvents = await db.query.conversationEvents.findMany({
      where: and(eq(conversationEvents.projectId, conversation.projectId), eq(conversationEvents.conversationId, conversation.id)),
      orderBy: asc(conversationEvents.timestamp),
    });
    context.events = allEvents.map(e => ({
      id: e.id,
      eventType: e.eventType,
      timestamp: e.timestamp.toISOString(),
      eventData: e.eventData as ConversationEventData,
      metadata: e.metadata as Record<string, any> | undefined,
    }));
    context.history = await this.historyBuilder.buildHistory(context.events, context);

    return context;
  }

  /**
   * Builds context specifically for a context transformer with the full stage context.
   * Unlike the classifier context, no action filtering is applied — transformers receive the complete stage view.
   * Also populates a special `schema` variable describing the shape of stage variables and the transformer's expected output fields.
   * @param conversation - Conversation entity
   * @param stage - Stage entity with agent relation
   * @param globalActions - Array of global actions for the stage
   * @param transformerId - ID of the transformer being executed (reserved for future per-transformer filtering)
   * @param contextFields - The list of field names this transformer is expected to output (from transformer.contextFields)
   * @param userInput - The user input text
   * @param originalUserInput - The original user input before any transformations
   */
  async buildContextForTransformer(conversation: Conversation, stage: Stage, globalActions: GlobalAction[], transformerId: string, contextFields: string[], userInput?: string, originalUserInput?: string): Promise<ConversationContext> {
    // Load user data
    const user = await db.query.users.findFirst({
      where: and(eq(users.projectId, conversation.projectId), eq(users.id, conversation.userId)),
    });

    // Load project constants
    const project = await db.query.projects.findFirst({
      where: eq(projects.id, conversation.projectId),
      columns: { constants: true, timezone: true, languageCode: true },
    });

    const rawContext = this.buildRawContext(conversation, stage, user?.profile || {}, project?.constants || {}, this.buildProjectContext(project?.timezone ?? null, project?.languageCode ?? null));
    rawContext.userInput = userInput;
    rawContext.originalUserInput = originalUserInput;

    // Build pseudo-JSON schema strings from stage variableDescriptors
    const stageVarDescriptors: FieldDescriptor[] = stage.variableDescriptors ?? [];
    const stageVarDescriptorMap = new Map(stageVarDescriptors.map(d => [d.name, d]));

    // Cross-reference contextFields against stage descriptors; fall back to a minimal string descriptor for unknown fields
    const outputFieldDescriptors: FieldDescriptor[] = (contextFields ?? []).map(fieldName => (
      stageVarDescriptorMap.get(fieldName) ?? { name: fieldName, type: 'string', isArray: false }
    ));

    const stageVars = conversation.stageVars[conversation.stageId] || {};

    // Pick current values for the fields this transformer is expected to output
    const transformerContext: Record<string, any> = {};
    for (const fieldName of contextFields ?? []) {
      transformerContext[fieldName] = stageVars[fieldName];
    }

    const context: ConversationContext = {
      conversationId: conversation.id,
      projectId: conversation.projectId,
      vars: stageVars,
      stageVars: conversation.stageVars,
      userProfile: user?.profile || {},
      consts: project?.constants || {},
      agent: (stage as any).agent?.prompt,
      history: [],
      events: [],
      actions: {},
      userInput,
      originalUserInput,
      results: {
        webhooks: {},
        tools: {},
      },
      schema: fieldDescriptorsToPseudoJson(outputFieldDescriptors),
      context: transformerContext,
      time: this.buildTimeContext((conversation.metadata?.timezone as string | undefined) ?? 'UTC'),
      project: this.buildProjectContext(project?.timezone ?? null, project?.languageCode ?? null),
      stage: await this.buildStageContext(stage, rawContext),
    };

    // Get all events from database; history is a filtered view on message events
    const allEvents = await db.query.conversationEvents.findMany({
      where: and(eq(conversationEvents.projectId, conversation.projectId), eq(conversationEvents.conversationId, conversation.id)),
      orderBy: asc(conversationEvents.timestamp),
    });
    context.events = allEvents.map(e => ({
      id: e.id,
      eventType: e.eventType,
      timestamp: e.timestamp.toISOString(),
      eventData: e.eventData as ConversationEventData,
      metadata: e.metadata as Record<string, any> | undefined,
    }));
    context.history = await this.historyBuilder.buildHistory(context.events, context);

    return context;
  }

  /**
   * Builds a full conversation context for main completion processing, including all actions and history.
   * This is used when processing user input for generating assistant responses, where all available information should be included in the context.
   * @param conversation - Conversation entity
   * @param stage - Stage entity with agent relation
   * @param userInput - The user input text
   * @param originalUserInput - The original user input before any transformations
   * @param actions - Array of action classification results
   * @param faq - Optional FAQ items from knowledge base to include in the context
   * @returns ConversationContext with all relevant data for processing user input and generating responses, including all actions that can be triggered by user input.
   */
  async buildContextForUserInput(conversation: Conversation, stage: Stage, actions: ActionClassificationResult[], userInput: string, originalUserInput: string, faq?: FaqItem[]): Promise<ConversationContext> {
    // Load user data
    const user = await db.query.users.findFirst({
      where: and(eq(users.projectId, conversation.projectId), eq(users.id, conversation.userId)),
    });

    // Load project constants
    const project = await db.query.projects.findFirst({
      where: eq(projects.id, conversation.projectId),
      columns: { constants: true, timezone: true, languageCode: true },
    });

    const context = {
      conversationId: conversation.id,
      projectId: conversation.projectId,
      vars: conversation.stageVars[conversation.stageId] || {},
      stageVars: conversation.stageVars,
      userProfile: user?.profile || {},
      consts: project?.constants || {},
      agent: (stage as any).agent?.prompt,
      history: [],
      events: [],
      actions: actions.reduce((acc, action) => {
        acc[action.name] = { parameters: action.parameters };
        return acc;
      }, {} as Record<string, { parameters: Record<string, any> }>),
      userInput,
      originalUserInput,
      faq: faq ?? [],
      results: {
        webhooks: {},
        tools: {},
      },
      time: this.buildTimeContext((conversation.metadata?.timezone as string | undefined) ?? 'UTC'),
      project: this.buildProjectContext(project?.timezone ?? null, project?.languageCode ?? null),
      stage: await this.buildStageContext(stage, this.buildRawContext(conversation, stage, user?.profile || {}, project?.constants || {}, this.buildProjectContext(project?.timezone ?? null, project?.languageCode ?? null))),
    };

    // Get all events from database; history is a filtered view on message events
    const allEvents = await db.query.conversationEvents.findMany({
      where: and(eq(conversationEvents.projectId, conversation.projectId), eq(conversationEvents.conversationId, conversation.id)),
      orderBy: asc(conversationEvents.timestamp),
    });
    context.events = allEvents.map(e => ({
      id: e.id,
      eventType: e.eventType,
      timestamp: e.timestamp.toISOString(),
      eventData: e.eventData as ConversationEventData,
      metadata: e.metadata as Record<string, any> | undefined,
    }));
    context.history = await this.historyBuilder.buildHistory(context.events, context);

    return context;
  }

  /**
   * Builds a minimal context with only raw data for use in action condition evaluation.
   * No filtering is applied here. Use for evaluating condition statements in actions.
   * 
   * @param conversation - Conversation entity
   * @param stage - Stage entity
   * @returns ConversationContext with only raw data and no filtering for actions or stage context.
   */
  public buildRawContext(conversation: Conversation, stage: Stage, userProfile: Record<string, any>, consts: Record<string, any> = {}, projectContext: ConversationContext['project'] = { timezone: null, languageCode: null, language: null }): ConversationContext {
    return {
      conversationId: conversation.id,
      projectId: conversation.projectId,
      vars: conversation.stageVars[conversation.stageId] || {},
      stageVars: conversation.stageVars,
      userProfile: userProfile || {}, // Not loaded in raw context
      consts,
      history: [], // Not loaded in raw context
      events: [], // Not loaded in raw context
      actions: {}, // Not loaded in raw context
      results: {
        webhooks: {},
        tools: {},
      },
      time: this.buildTimeContext((conversation.metadata?.timezone as string | undefined) ?? 'UTC'),
      project: projectContext,
      stage: {
          id: conversation.stageId,
          name: stage.name,
          availableActions: stage.actions ? Object.entries(stage.actions).map(([_, action]) => ({
            name: action.name,
            trigger: action.classificationTrigger,
            examples: action.examples || undefined,
            parameters: action.parameters?.map(p => ({
              name: p.name,
              type: p.type,
              description: p.description,
              required: p.required,
            })),
          })) : [],
          useKnowledge: stage.useKnowledge,
          enterBehavior: stage.enterBehavior,
          metadata: stage.metadata || undefined,          
      }
    };
  }
}