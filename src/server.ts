import 'reflect-metadata';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { container } from 'tsyringe';
import swaggerUi from 'swagger-ui-express';
import qs from 'qs';
import { OperatorController } from './http/controllers/OperatorController';
import { UserController } from './http/controllers/UserController';
import { AgentController } from './http/controllers/AgentController';
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
import { GuardrailController } from './http/controllers/GuardrailController';
import { SampleCopyController } from './http/controllers/SampleCopyController';
import { CopyDecoratorController } from './http/controllers/CopyDecoratorController';
import { EnvironmentController } from './http/controllers/EnvironmentController';
import { ProviderController } from './http/controllers/ProviderController';
import { ProviderCatalogController } from './http/controllers/ProviderCatalogController';
import { ProjectProviderUsageController } from './http/controllers/ProjectProviderUsageController';
import { ChannelCatalogController } from './http/controllers/ChannelCatalogController';
import { AuditController } from './http/controllers/AuditController';
import { AnalyticsController } from './http/controllers/AnalyticsController';
import { SavedSliceQueryController } from './http/controllers/SavedSliceQueryController';
import { FunnelController } from './http/controllers/FunnelController';
import { ApiKeyController } from './http/controllers/ApiKeyController';
import { VersionController } from './http/controllers/VersionController';
import { ExternalTriggerController } from './http/controllers/ExternalTriggerController';
import { MigrationController } from './http/controllers/MigrationController';
import { ProjectExchangeController } from './http/controllers/ProjectExchangeController';
import { ConversationTimeoutService } from './services/ConversationTimeoutService';
import { ScenarioRunExecutorService } from './services/testing/ScenarioRunExecutorService';
import { ImapInboundService } from './services/ImapInboundService';
import { ProcessingDeferralService } from './services/ProcessingDeferralService';
import { OAuth2TokenRefreshService } from './services/OAuth2TokenRefreshService';
import { errorHandler } from './http/middleware/errorHandler';
import { optionalAuthMiddleware } from './http/middleware/auth';
import { requestContextMiddleware } from './http/middleware/requestContext';
import { createApiRateLimiter } from './http/middleware/rateLimiter';
import { getOpenAPISpec } from './swagger';
import { setSpecProvider } from './services/VersionService';
import { WebSocketChannelHost } from './channels/websocket/WebSocketChannelHost';
import { WebRTCChannelHost } from './channels/webrtc/WebRTCChannelHost';
import { TwilioMessagingChannelHost } from './channels/twilio-messaging/TwilioMessagingChannelHost';
import { TwilioVoiceChannelHost } from './channels/twilio-voice/TwilioVoiceChannelHost';
import { WhatsAppChannelHost } from './channels/whatsapp/WhatsAppChannelHost';
import { TelegramChannelHost } from './channels/telegram/TelegramChannelHost';
// import { SendGridChannelHost } from './channels/email/sendgrid/SendGridChannelHost';
// import { SesChannelHost } from './channels/email/ses/SesChannelHost';
import { SmtpImapChannelHost } from './channels/email/smtp-imap/SmtpImapChannelHost';
import { SmtpImapOAuth2Controller } from './http/controllers/SmtpImapOAuth2Controller';
import logger from './utils/logger';
import { fileURLToPath } from 'url';
import { SecretsManagerRegistry } from './services/secrets/SecretsManagerRegistry';
import { LocalSecretsManager, LOCAL_SECRETS_MANAGER_NAME } from './services/secrets/LocalSecretsManager';
import { SecretController } from './http/controllers/SecretController';
import { TesterController } from './http/controllers/TesterController';
import { ScenarioController } from './http/controllers/ScenarioController';
import { ScenarioRunController } from './http/controllers/ScenarioRunController';
import { ScenarioConversationController } from './http/controllers/ScenarioConversationController';
import { BenchmarkSuiteController } from './http/controllers/BenchmarkSuiteController';
import { BenchmarkProviderConfigController } from './http/controllers/BenchmarkProviderConfigController';
import { BenchmarkConfigController } from './http/controllers/BenchmarkConfigController';
import { BenchmarkRunController } from './http/controllers/BenchmarkRunController';
import { QuickPromptController } from './http/controllers/QuickPromptController';
import { DeferredProcessingController } from './http/controllers/DeferredProcessingController';
import { BenchmarkExecutorService } from './services/BenchmarkExecutorService';
import SpeexResamplerClass from './services/audio/speexResampler';
import smartTurnDetector from './services/audio/SmartTurnDetector';
import { preloadFireRedVad } from './services/audio/FireRedVadWrapper';

// Register the OpenAPI spec provider before the IoC container is used.
// This breaks the circular module dependency that would arise from VersionService
// importing swagger.ts directly (swagger → MigrationController → MigrationService → VersionService).
setSpecProvider(getOpenAPISpec);

/**
 * Creates and configures the Express application
 */
export async function createApp(): Promise<express.Application> {
  const app = express();

  // Trust proxy headers when running behind a reverse proxy (nginx, load balancer, etc.)
  // This ensures req.ip reflects the real client IP from X-Forwarded-For.
  // Set TRUST_PROXY=false to disable (default: enabled).
  if (process.env.TRUST_PROXY !== 'false') {
    app.set('trust proxy', 1);
  }

  // Configure query parser to use qs for nested query parameters
  app.set('query parser', (str: string) => qs.parse(str, { allowDots: true, depth: 10 }));

  // Parse JSON bodies (10mb limit accommodates migration import bundles)
  // The verify callback captures the raw buffer so webhook handlers can validate HMAC-SHA256 signatures.
  app.use(express.json({ limit: '10mb', verify: (req: any, _res, buf) => { req.rawBody = buf; } }));

  // Parse URL-encoded bodies (used by Twilio webhooks)
  app.use(express.urlencoded({ extended: false }));

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
    const schemaUrl = new URL('../schemas/websocket-contracts.json', import.meta.url);
    const schemaPath = fileURLToPath(schemaUrl);
    res.sendFile(schemaPath);
  });

  // LLM-ingestible guide endpoint
  app.get('/llms.txt', (req, res) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    const llmsUrl = new URL('../llms.txt', import.meta.url);
    const llmsPath = fileURLToPath(llmsUrl);
    res.sendFile(llmsPath);
  });

  // Unauthenticated system endpoints — registered before auth middleware intentionally
  const versionController = container.resolve(VersionController);
  versionController.registerRoutes(app);

  // Bootstrap secrets manager registry — must run before any controller that uses ProviderService / EnvironmentService
  const secretsRegistry = container.resolve(SecretsManagerRegistry);
  const localSecretsManager = container.resolve(LocalSecretsManager);
  secretsRegistry.register(LOCAL_SECRETS_MANAGER_NAME, localSecretsManager);

  // Authentication middleware (optional - sets req.user if token is valid)
  app.use(optionalAuthMiddleware);

  // Request context middleware (creates req.context from req.user)
  app.use(requestContextMiddleware);

  // General API rate limiter — keyed by authenticated operator ID, falls back to IP
  app.use(createApiRateLimiter());

  // External trigger endpoint — uses API key auth, not operator JWT; registered after rate limiter for IP-based limiting
  const externalTriggerController = container.resolve(ExternalTriggerController);
  externalTriggerController.registerRoutes(app);

  // Register routes for all controllers
  const authController = container.resolve(AuthController);
  authController.registerRoutes(app);

  const setupController = container.resolve(SetupController);
  setupController.registerRoutes(app);

  const operatorController = container.resolve(OperatorController);
  operatorController.registerRoutes(app);

  const projectController = container.resolve(ProjectController);
  projectController.registerRoutes(app);

  const auditController = container.resolve(AuditController);
  auditController.registerRoutes(app);

  const analyticsController = container.resolve(AnalyticsController);
  analyticsController.registerRoutes(app);

  const savedSliceQueryController = container.resolve(SavedSliceQueryController);
  savedSliceQueryController.registerRoutes(app);

  const funnelController = container.resolve(FunnelController);
  funnelController.registerRoutes(app);

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

  const sampleCopyController = container.resolve(SampleCopyController);
  sampleCopyController.registerRoutes(app);

  const copyDecoratorController = container.resolve(CopyDecoratorController);
  copyDecoratorController.registerRoutes(app);

  const guardrailController = container.resolve(GuardrailController);
  guardrailController.registerRoutes(app);

  const issueController = container.resolve(IssueController);
  issueController.registerRoutes(app);

  const knowledgeController = container.resolve(KnowledgeController);
  knowledgeController.registerRoutes(app);

  const agentController = container.resolve(AgentController);
  agentController.registerRoutes(app);

  const providerController = container.resolve(ProviderController);
  providerController.registerRoutes(app);

  const providerCatalogController = container.resolve(ProviderCatalogController);
  providerCatalogController.registerRoutes(app);

  const projectProviderUsageController = container.resolve(ProjectProviderUsageController);
  projectProviderUsageController.registerRoutes(app);

  const channelCatalogController = container.resolve(ChannelCatalogController);
  channelCatalogController.registerRoutes(app);

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

  const projectExchangeController = container.resolve(ProjectExchangeController);
  projectExchangeController.registerRoutes(app);

  const secretController = container.resolve(SecretController);
  secretController.registerRoutes(app);

  const testerController = container.resolve(TesterController);
  testerController.registerRoutes(app);

  const scenarioController = container.resolve(ScenarioController);
  scenarioController.registerRoutes(app);

  const scenarioRunController = container.resolve(ScenarioRunController);
  scenarioRunController.registerRoutes(app);

  const scenarioConversationController = container.resolve(ScenarioConversationController);
  scenarioConversationController.registerRoutes(app);

  container.resolve(BenchmarkSuiteController).registerRoutes(app);
  container.resolve(BenchmarkProviderConfigController).registerRoutes(app);
  container.resolve(BenchmarkConfigController).registerRoutes(app);
  container.resolve(BenchmarkRunController).registerRoutes(app);

  const quickPromptController = container.resolve(QuickPromptController);
  quickPromptController.registerRoutes(app);

  const deferredProcessingController = container.resolve(DeferredProcessingController);
  deferredProcessingController.registerRoutes(app);

  container.resolve(WebRTCChannelHost).registerRoutes(app);
  container.resolve(TwilioMessagingChannelHost).registerRoutes(app);
  container.resolve(TwilioVoiceChannelHost).registerRoutes(app);
  container.resolve(WhatsAppChannelHost).registerRoutes(app);
  container.resolve(TelegramChannelHost).registerRoutes(app);
  // container.resolve(SendGridChannelHost).registerRoutes(app);
  // container.resolve(SesChannelHost).registerRoutes(app);
  container.resolve(SmtpImapChannelHost).registerRoutes(app);

  const smtpImapOAuth2Controller = container.resolve(SmtpImapOAuth2Controller);
  smtpImapOAuth2Controller.registerRoutes(app);

  try {
    await SpeexResamplerClass.initPromise;
    const warmup = new SpeexResamplerClass(1, 16000, 8000, 3);
    warmup.processChunk(Buffer.alloc(320));
    logger.info('Speex resampler WASM initialized');
  } catch (err) {
    logger.warn({ error: err.message }, 'Speex resampler failed to initialize (non-fatal, will load on first use)');
  }

  try {
    await smartTurnDetector.load();
  } catch (err) {
    logger.warn({ error: err.message }, 'Smart Turn detector failed to load (non-fatal, endpoint detection disabled)');
  }

  try {
    await preloadFireRedVad();
  } catch (err) {
    logger.warn({ error: err.message }, 'FireRedVAD failed to preload (non-fatal, will load on first use)');
  }

  container.resolve(ConversationTimeoutService).start();
  container.resolve(ScenarioRunExecutorService).start();
  container.resolve(BenchmarkExecutorService).start();
  container.resolve(ImapInboundService).start();
  container.resolve(OAuth2TokenRefreshService).start();
  container.resolve(ProcessingDeferralService).start();

  app.use(errorHandler);

  return app;
}

/**
 * Starts the HTTP server and initializes WebSocket host
 */
export async function startServer(port: number = 3000): Promise<void> {
  const app = await createApp();
  const server = createServer(app);

  // Initialize WebSocket host
  const wsHost = container.resolve(WebSocketChannelHost);
  wsHost.initialize(server);

  // Initialize Twilio Voice Media Streams host
  container.resolve(TwilioVoiceChannelHost).initialize(server);

  server.listen(port, () => {
    logger.info({ port }, 'HTTP server started');
  });
}
