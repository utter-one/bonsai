import { ExpressMiddlewareInterface, Middleware } from 'routing-controllers';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { getValidationMetadata } from '../decorators/validation';


/**
 * Middleware that automatically validates parameters decorated with @Validated
 * Runs before controller methods execute and validates using the provided Zod schemas
 */
@Middleware({ type: 'before' })
export class ValidationMiddleware implements ExpressMiddlewareInterface {
  use(req: Request, res: Response, next: NextFunction): void {
    const action = (req as any).action;
    if (!action) {
      return next();
    }

    const { target, method } = action;
    const { schemas, sources } = getValidationMetadata(target.constructor.prototype, method);

    try {
      for (const [paramIndex, schema] of Object.entries(schemas)) {
        const source = sources[paramIndex as any];
        let data: any;

        switch (source) {
          case 'body':
            data = req.body;
            req.body = schema.parse(data);
            break;
          case 'query':
            data = req.query;
            req.query = schema.parse(data) as any;
            break;
          case 'params':
            data = req.params;
            req.params = schema.parse(data) as any;
            break;
        }
      }
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        next(error);
      } else {
        next(error);
      }
    }
  }
}
