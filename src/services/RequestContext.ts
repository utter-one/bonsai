/**
 * Request context type that flows through all service methods for auditing and authorization
 * Contains authentication information and request metadata
 */
export type RequestContext = {
  /** The authenticated operator user ID */
  operatorId: string;
  /** Roles assigned to the authenticated operator */
  roles: string[];
  /** IP address of the client making the request */
  ip: string;
  /** User agent string from the client */
  userAgent: string;
  /** Unique identifier for this request */
  requestId: string;
  /** Timestamp when the request was received */
  timestamp: Date;
};
