import 'reflect-metadata';
import express from 'express';
import { useExpressServer, useContainer } from 'routing-controllers';
import { container } from 'tsyringe';
import swaggerUi from 'swagger-ui-express';
import { AdminController } from './controllers/AdminController';
import { UserController } from './controllers/UserController';
import { PersonaController } from './controllers/PersonaController';
import { AuthController } from './controllers/AuthController';
import { KnowledgeController } from './controllers/KnowledgeController';
import { IssueController } from './controllers/IssueController';
import { ConversationController } from './controllers/ConversationController';
import { StageController } from './controllers/StageController';
import { ClassifierController } from './controllers/ClassifierController';
import { ContextTransformerController } from './controllers/ContextTransformerController';
import { ToolController } from './controllers/ToolController';
import { GlobalActionController } from './controllers/GlobalActionController';
import { EnvironmentController } from './controllers/EnvironmentController';
import { AuditController } from './controllers/AuditController';
import { errorHandler } from './middleware/errorHandler';
import { optionalAuthMiddleware } from './middleware/auth';
import { requestContextMiddleware } from './middleware/requestContext';
import { ValidationMiddleware } from './middleware/validation';
import { PermissionInterceptor } from './middleware/authorization';
import { getOpenAPISpec } from './swagger';
import { SetupService } from './services/SetupService';
import { initialAdminSetupSchema } from './contracts/rest/setup';
import logger from './utils/logger';

/**
 * Creates and configures the Express application
 */
export function createApp(): express.Application {
  const app = express();

  app.use(express.json());

  // Health check endpoint - bypasses all middleware for reliability
  app.get('/health', (req, res) => {
    res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
    });
  });

  // Setup endpoints - public routes that bypass authentication
  const setupService = container.resolve(SetupService);
  
  app.get('/api/setup/status', async (req, res, next) => {
    try {
      const status = await setupService.getSetupStatus();
      res.status(200).json(status);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/setup/initial-admin', async (req, res, next) => {
    try {
      const validated = initialAdminSetupSchema.parse(req.body);
      const result = await setupService.createInitialAdmin(validated);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  });

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
    controllers: [AuthController, AdminController, UserController, PersonaController, KnowledgeController, IssueController, ConversationController, StageController, ClassifierController, ContextTransformerController, ToolController, GlobalActionController, EnvironmentController, AuditController],
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
