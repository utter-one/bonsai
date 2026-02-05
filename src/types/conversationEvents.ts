import { ConversationState } from "../services/live/ConversationRunner";
import { ClassificationResultWithClassifier } from "../services/live/UserInputProcessor";
import { Effect } from "./actions";

// Conversation Event Types
export type ConversationEventType =
  | 'message'
  | 'classification'
  | 'action'
  | 'command'
  | 'conversation_start'
  | 'conversation_resume'
  | 'conversation_end'
  | 'conversation_aborted'
  | 'conversation_failed'
  | 'jump_to_stage';

// Event Data Types
export type MessageEventData = {
  role: 'user' | 'assistant';
  text: string;
  originalText: string;
  metadata?: Record<string, any>;
};

export type ClassificationEventData = {
  classifierId: string;
  input: string;
  actions: ClassificationResultWithClassifier[];
  metadata?: Record<string, any>;
};

export type ActionEventData = {
  actionName: string;
  stageId: string;
  effects: Effect[];
  metadata?: Record<string, any>;
};

export type CommandEventData = {
  command: string;
  parameters?: Record<string, any>;
  metadata?: Record<string, any>;
};

export type ConversationStartEventData = {
  stageId: string;
  initialVariables?: Record<string, any>;
  metadata?: Record<string, any>;
};

export type JumpToStageEventData = {
  fromStageId: string;
  toStageId: string;
  metadata?: Record<string, any>;
};

export type ConversationResumeEventData = {
  previousStatus: ConversationState;
  stageId: string;
  metadata?: Record<string, any>;
};

export type ConversationEndEventData = {
  reason?: string;
  stageId: string;
  metadata?: Record<string, any>;
};

export type ConversationAbortedEventData = {
  reason: string;
  stageId: string;
  metadata?: Record<string, any>;
};

export type ConversationFailedEventData = {
  error: string;
  stageId?: string;
  metadata?: Record<string, any>;
};

export type ConversationEventData =
  | MessageEventData
  | ClassificationEventData
  | ActionEventData
  | CommandEventData
  | ConversationStartEventData
  | ConversationResumeEventData
  | ConversationEndEventData
  | ConversationAbortedEventData
  | ConversationFailedEventData
  | JumpToStageEventData;
