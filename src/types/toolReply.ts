/** Status of a pending tool reply */
export type PendingToolReplyStatus = 'pending' | 'replied' | 'timed_out' | 'expired' | 'failed_validation' | 'discarded';

/** Request body for submitting a tool reply */
export interface ToolReplyRequest {
  /** The request ID that was sent to the external service */
  requestId: string;
  /** Tool result data to return to the conversation */
  data?: Record<string, unknown>;
  /** Flow-control effects to apply to the conversation */
  effects?: Array<{
    type: string;
    payload: Record<string, unknown>;
  }>;
}

/** Response returned when a tool reply is accepted */
export interface ToolReplyResponse {
  success: boolean;
  requestId: string;
  message: string;
}

/** Represents a pending tool reply record */
export interface PendingToolReply {
  id: string;
  projectId: string;
  conversationId: string;
  toolId: string;
  requestId: string;
  status: PendingToolReplyStatus;
  replyData: Record<string, unknown> | null;
  replyEffects: Array<{ type: string; payload: Record<string, unknown> }> | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

/** Context passed when executing a tool reply */
export interface ToolReplyContext {
  operatorId: string;
  projectId: string;
  conversationId: string;
}
