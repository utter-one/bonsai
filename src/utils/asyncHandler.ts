import type { Request, Response, NextFunction } from 'express';
import logger from './logger';

/**
 * Wraps an async route handler to catch errors and pass them to Express error handler
 */
export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
