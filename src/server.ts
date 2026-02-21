import 'reflect-metadata';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { container } from 'tsyringe';
import swaggerUi from 'swagger-ui-express';
import qs from 'qs';
import { AdminController } from './http/controllers/AdminController';
import { UserController } from './http/controllers/UserController';
import { PersonaController } from './http/controllers/PersonaController';
import { ProjectController } from './http/controllers/ProjectController';
import { AuthController } from './http/controllers/AuthController';
import { SetupController } from './http/controllers/SetupController';
import { KnowledgeController } from './http/controllers/KnowledgeController';
import { IssueController } from './http/controllers/IssueController';
import { ConversationController } from './http/controllers/ConversationController';
import { StageController } from './http/controllers/StageController';
import { ClassifierController } from './http/controllers/ClassifierController';
import { ContextTransformerController } from './http/controllers/ContextTransformerController';
import { ToolController } from './http/controllers/ToolController';
import { GlobalActionController } from './http/controllers/GlobalActionController';
import { EnvironmentController } from './http/controllers/EnvironmentController';
import { ProviderController } from './http/controllers/ProviderController';
import { ProviderCatalogController } from './http/controllers/ProviderCatalogController';
import { AuditController } from './http/controllers/AuditController';
import { ApiKeyController } from './http/controllers/ApiKeyController';
import { VersionController } from './http/controllers/VersionController';
import { MigrationController } from './http/controllers/MigrationController';
import { errorHandler } from './http/middleware/errorHandler';
import { optionalAuthMiddleware } from './http/middleware/auth';
import { requestContextMiddleware } from './http/middleware/requestContext';
import { getOpenAPISpec } from './swagger';
import { ConversationServer } from './websocket/ConversationServer';
import logger from './utils/logger';

/**
 * Creates and configures the Express application
 */
export function createApp(): express.Application {
  const app = express();

  // Configure query parser to use qs for nested query parameters
  app.set('query parser', (str: string) => qs.parse(str, { allowDots: true, depth: 10 }));

  // Parse JSON bodies (10mb limit accommodates migration import bundles)
  app.use(express.json({ limit: '10mb' }));

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

  // OpenAPI JSON endpoint
  app.get('/openapi.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(swaggerSpec, null, 2));
  });

  // WebSocket Contracts JSON Schema endpoint
  app.get('/websocket-contracts.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const schemaPath = new URL('../schemas/websocket-contracts.json', import.meta.url);
    res.sendFile(schemaPath.pathname);
  });

  // Unauthenticated system endpoints — registered before auth middleware intentionally
  const versionController = container.resolve(VersionController);
  versionController.registerRoutes(app);

  // Authentication middleware (optional - sets req.user if token is valid)
  app.use(optionalAuthMiddleware);
  
  // Request context middleware (creates req.context from req.user)
  app.use(requestContextMiddleware);

  // Register routes for all controllers
  const authController = container.resolve(AuthController);
  authController.registerRoutes(app);

  const setupController = container.resolve(SetupController);
  setupController.registerRoutes(app);

  const adminController = container.resolve(AdminController);
  adminController.registerRoutes(app);
  
  const projectController = container.resolve(ProjectController);
  projectController.registerRoutes(app);

  const auditController = container.resolve(AuditController);
  auditController.registerRoutes(app);

  const classifierController = container.resolve(ClassifierController);
  classifierController.registerRoutes(app);

  const contextTransformerController = container.resolve(ContextTransformerController);
  contextTransformerController.registerRoutes(app);

  const conversationController = container.resolve(ConversationController);
  conversationController.registerRoutes(app);

  const environmentController = container.resolve(EnvironmentController);
  environmentController.registerRoutes(app);

  const globalActionController = container.resolve(GlobalActionController);
  globalActionController.registerRoutes(app);

  const issueController = container.resolve(IssueController);
  issueController.registerRoutes(app);

  const knowledgeController = container.resolve(KnowledgeController);
  knowledgeController.registerRoutes(app);

  const personaController = container.resolve(PersonaController);
  personaController.registerRoutes(app);

  const providerController = container.resolve(ProviderController);
  providerController.registerRoutes(app);

  const providerCatalogController = container.resolve(ProviderCatalogController);
  providerCatalogController.registerRoutes(app);

  const stageController = container.resolve(StageController);
  stageController.registerRoutes(app);

  const toolController = container.resolve(ToolController);
  toolController.registerRoutes(app);

  const userController = container.resolve(UserController);
  userController.registerRoutes(app);

  const apiKeyController = container.resolve(ApiKeyController);
  apiKeyController.registerRoutes(app);

  const migrationController = container.resolve(MigrationController);
  migrationController.registerRoutes(app);

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
