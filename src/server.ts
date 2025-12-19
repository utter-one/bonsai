import 'reflect-metadata';
import express from 'express';
import { useExpressServer, useContainer } from 'routing-controllers';
import { container } from 'tsyringe';
import swaggerUi from 'swagger-ui-express';
import { AdminController } from './controllers/AdminController';
import { errorHandler } from './middleware/errorHandler';
import { authContextMiddleware } from './middleware/authContext';
import { ValidationMiddleware } from './middleware/validation';
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
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

  app.use(authContextMiddleware);

  useContainer({
    get: (cls) => container.resolve(cls),
  });

  useExpressServer(app, {
    controllers: [AdminController],
    middlewares: [ValidationMiddleware],
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
