import 'reflect-metadata';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { useExpressServer, useContainer } from 'routing-controllers';
import { container } from 'tsyringe';
import swaggerUi from 'swagger-ui-express';
import { AdminController } from './http/controllers/AdminController';
import { UserController } from './http/controllers/UserController';
import { PersonaController } from './http/controllers/PersonaController';
import { ProjectController } from './http/controllers/ProjectController';
import { AuthController } from './http/controllers/AuthController';
import { KnowledgeController } from './http/controllers/KnowledgeController';
import { IssueController } from './http/controllers/IssueController';
import { ConversationController } from './http/controllers/ConversationController';
import { StageController } from './http/controllers/StageController';
import { ClassifierController } from './http/controllers/ClassifierController';
import { ContextTransformerController } from './http/controllers/ContextTransformerController';
import { ToolController } from './http/controllers/ToolController';
import { GlobalActionController } from './http/controllers/GlobalActionController';
import { EnvironmentController } from './http/controllers/EnvironmentController';
import { AuditController } from './http/controllers/AuditController';
import { errorHandler } from './http/middleware/errorHandler';
import { optionalAuthMiddleware } from './http/middleware/auth';
import { requestContextMiddleware } from './http/middleware/requestContext';
import { ValidationMiddleware } from './http/middleware/validation';
import { PermissionInterceptor } from './http/middleware/authorization';
import { getOpenAPISpec } from './swagger';
import { SetupService } from './services/SetupService';
import { ConversationServer } from './websocket/ConversationServer';
import { initialAdminSetupSchema } from './http/contracts/setup';
import logger from './utils/logger';

/**
 * Creates and configures the Express application
 */
export function createApp(): express.Application {
  const app = express();

  // Parse JSON bodies
  app.use(express.json());

  // CORS configuration
  app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }));

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
    controllers: [AuthController, UserController, PersonaController, KnowledgeController, IssueController, ConversationController, StageController, ClassifierController, ContextTransformerController, ToolController, GlobalActionController, EnvironmentController, AuditController],
    middlewares: [ValidationMiddleware],
    interceptors: [PermissionInterceptor],
    defaultErrorHandler: false,
  });

  // Register explicit routes for migrated controllers
  const adminController = container.resolve(AdminController);
  adminController.registerRoutes(app);
  
  const projectController = container.resolve(ProjectController);
  projectController.registerRoutes(app);

  app.use(errorHandler);

  return app;
}

/**
 * Starts the HTTP server and initializes WebSocket host
 */
export function startServer(port: number = 3000): void {
  const app = createApp();
  const server = createServer(app);

  // Initialize WebSocket host
  const wsHost = container.resolve(ConversationServer);
  wsHost.initialize(server);

  server.listen(port, () => {
    logger.info({ port }, 'HTTP server started');
  });
}
