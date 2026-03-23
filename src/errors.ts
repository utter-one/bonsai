
/**
 * Error thrown when an optimistic locking conflict occurs during entity updates or deletions
 */
export class OptimisticLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OptimisticLockError';
  }
}

/**
 * Error thrown when a requested entity is not found
 */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

/**
 * Error thrown when an operation is invalid or not allowed in the current state
 */
export class InvalidOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidOperationError';
  }
}

/**
 * Error thrown when a remote service or environment is unreachable or returns an unexpected response
 */
export class RemoteConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RemoteConnectionError';
  }
}

/**
 * Error thrown when access to a resource is denied
 */
export class AccessDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccessDeniedError';
  }
}

/**
 * Error thrown when authentication is required but not provided
 */
export class UnauthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

/**
 * Error thrown when user lacks required permissions
 */
export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenError';
  }
}

/**
 * Error thrown when something is not configured
 */
export class NotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotConfiguredError';
  }
}

/**
 * Error thrown when an operation is blocked because the project is archived
 */
export class ArchivedProjectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArchivedProjectError';
  }
}

/**
 * Error thrown when user input is blocked by content moderation
 */
export class ContentModerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContentModerationError';
  }
}

/**
 * Error thrown when a rate limit has been exceeded
 */
export class TooManyRequestsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TooManyRequestsError';
  }
}
