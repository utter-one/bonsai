import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { UnauthorizedError } from '../../errors';
import { logger } from '../../utils/logger';

/** JWT payload structure */
export type JWTPayload = {
  operatorId: string;
  roles: string[];
  type: 'access' | 'refresh';
};

/**
 * Middleware to validate JWT tokens and authenticate requests
 * Attaches user information to req.user if token is valid
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  try {
    const authHeader = req.get('authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedError('Missing or invalid authorization header');
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    
    if (!process.env.JWT_SECRET) {
      logger.error('JWT_SECRET not configured');
      throw new UnauthorizedError('Authentication configuration error');
    }

    const payload = jwt.verify(token, process.env.JWT_SECRET) as JWTPayload;
    
    // Only accept access tokens for API calls
    if (payload.type !== 'access') {
      throw new UnauthorizedError('Invalid token type');
    }

    req.user = {
      operatorId: payload.operatorId,
      roles: payload.roles,
    };

    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      next(new UnauthorizedError('Invalid token'));
    } else if (error instanceof jwt.TokenExpiredError) {
      next(new UnauthorizedError('Token expired'));
    } else {
      next(error);
    }
  }
}

/**
 * Optional authentication middleware - continues even if authentication fails
 * Useful for routes that have different behavior for authenticated vs unauthenticated users
 */
export function optionalAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  try {
    const authHeader = req.get('authorization');
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      
      if (process.env.JWT_SECRET) {
        const payload = jwt.verify(token, process.env.JWT_SECRET) as JWTPayload;
        
        if (payload.type === 'access') {
          req.user = {
            operatorId: payload.operatorId,
            roles: payload.roles,
          };
        }
      }
    }
  } catch (error) {
    // Silently fail for optional auth
    logger.debug({ error }, 'Optional authentication failed');
  }
  
  next();
}
