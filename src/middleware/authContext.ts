import type { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

export type RequestContext = {
  userId?: string;
  isAuthenticated: boolean;
};

declare global {
  namespace Express {
    interface Request {
      context?: RequestContext;
    }
  }
}

/**
 * Middleware to extract and attach authentication context to requests
 * Currently extracts userId from X-User-Id header
 * TODO: Replace with proper JWT/session authentication
 */
export function authContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const userId = req.header('X-User-Id');

  req.context = {
    userId,
    isAuthenticated: !!userId,
  };

  if (userId) {
    logger.debug({ userId }, 'Request authenticated');
  }

  next();
}

/**
 * Middleware to require authentication for protected routes
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.context?.isAuthenticated) {
    logger.warn({ url: req.url, method: req.method }, 'Unauthorized access attempt');
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  next();
}
