import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { OptimisticLockError, NotFoundError, InvalidOperationError, AccessDeniedError, UnauthorizedError, ForbiddenError } from '../errors';
import logger from '../utils/logger';

/**
 * Global error handling middleware
 */
export function errorHandler(err: any, req: Request, res: Response, next: NextFunction): void {
  if (err instanceof z.ZodError) {
    res.status(400).json({ error: 'Validation failed', details: err.issues });
    return;
  }

  if (err instanceof UnauthorizedError) {
    res.status(401).json({ error: err.message });
    return;
  }

  if (err instanceof ForbiddenError) {
    res.status(403).json({ error: err.message });
    return;
  }

  if (err instanceof OptimisticLockError) {
    res.status(409).json({ error: err.message });
    return;
  }

  if (err instanceof NotFoundError) {
    res.status(404).json({ error: err.message });
    return;
  }

  if (err instanceof InvalidOperationError) {
    res.status(400).json({ error: err.message });
    return;
  }

  if (err instanceof AccessDeniedError) {
    res.status(403).json({ error: err.message });
    return;
  }

  if (err.status) {
    res.status(err.status).json({ error: err.message, details: err.details });
    return;
  }

  logger.error({ error: err, method: req.method, url: req.url }, 'Unhandled error');
  res.status(500).json({ error: 'Internal server error' });
}
