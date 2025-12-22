import 'reflect-metadata';
import express from 'express';
import { useExpressServer, useContainer } from 'routing-controllers';
import { container } from 'tsyringe';
import swaggerUi from 'swagger-ui-express';
import { AdminController } from './controllers/AdminController';
import { UserController } from './controllers/UserController';
import { PersonaController } from './controllers/PersonaController';
import { AuthController } from './controllers/AuthController';
import { errorHandler } from './middleware/errorHandler';
import { optionalAuthMiddleware } from './middleware/auth';
import { requestContextMiddleware } from './middleware/requestContext';
import { ValidationMiddleware } from './middleware/validation';
import { PermissionInterceptor } from './middleware/authorization';
import { getOpenAPISpec } from './swagger';
import logger from './utils/logger';

/**
 * Creates and configures the Express application
 */
export function createApp(): express.Application {
  const app = express();

  app.use(express.json());

  app.use((req, res, next) => {
    logger.info({ method: req.method, url: req.url }, 'Incoming request');
    next();
  });

  // Swagger UI
  const swaggerSpec = getOpenAPISpec();
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    swaggerOptions: {
      defaultModelsExpandDepth: 1,
      defaultModelExpandDepth: 3,
      docExpansion: 'list',
      filter: true,
    },
  }));

  // Authentication middleware (optional - sets req.user if token is valid)
  app.use(optionalAuthMiddleware);
  
  // Request context middleware (creates req.context from req.user)
  app.use(requestContextMiddleware);

  useContainer({
    get: (cls) => container.resolve(cls),
  });

  useExpressServer(app, {
    controllers: [AdminController, UserController, PersonaController, AuthController],
    middlewares: [ValidationMiddleware],
    interceptors: [PermissionInterceptor],
    defaultErrorHandler: false,
  });

  app.use(errorHandler);

  return app;
}

/**
 * Starts the HTTP server
 */
export function startServer(port: number = 3000): void {
  const app = createApp();

  app.listen(port, () => {
    logger.info({ port }, 'HTTP server started');
  });
}
