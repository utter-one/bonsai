import type { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { RequestContext } from '../../services/RequestContext';

// Extend Express Request type to include context and user
declare global {
  namespace Express {
    interface Request {
      context?: RequestContext;
      user?: {
        adminId: string;
        roles: string[];
      };
    }
  }
}

/**
 * Middleware to create request context for authenticated requests
 * This middleware should run after authentication middleware
 */
export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  // If authentication was successful, create context
  if (req.user) {
    req.context = {
      adminId: req.user.adminId,
      roles: req.user.roles,
      ip: (req.ip || req.socket.remoteAddress || 'unknown'),
      userAgent: req.get('user-agent') || 'unknown',
      requestId: uuidv4(),
      timestamp: new Date(),
    };
  }

  next();
}

