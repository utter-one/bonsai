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

/**
 * Pre-built context for system-internal calls (background services, channel hosts).
 * Grants all permissions via super_admin role.
 */
export const SYSTEM_CONTEXT: RequestContext = {
  operatorId: 'system',
  roles: ['super_admin'],
  ip: '127.0.0.1',
  userAgent: 'system',
  requestId: 'system',
  timestamp: new Date(),
};
