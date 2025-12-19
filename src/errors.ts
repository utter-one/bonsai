
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
 * Error thrown when access to a resource is denied
 */
export class AccessDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccessDeniedError';
  }
}
