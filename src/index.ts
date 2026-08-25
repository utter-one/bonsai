import "reflect-metadata";
import "dotenv/config";
import { db } from "./db/index";
import logger from "./utils/logger";
import { sql } from "drizzle-orm";
import { container } from "tsyringe";
import { startServer } from "./server";
import { installShutdownHandlers } from "./utils/shutdown";
import { endPool } from "./db/index";
import { parseEnvInt } from "./utils/env";
import { ConversationTimeoutService } from "./services/ConversationTimeoutService";
import { ScenarioRunExecutorService } from "./services/testing/ScenarioRunExecutorService";
import { BenchmarkExecutorService } from "./services/BenchmarkExecutorService";
import { ImapInboundService } from "./services/ImapInboundService";
import { OAuth2TokenRefreshService } from "./services/OAuth2TokenRefreshService";
import { ProcessingDeferralService } from "./services/ProcessingDeferralService";
import { HealthCheckService } from "./services/monitoring/HealthCheckService";
import { AlertRuleEngine } from "./services/monitoring/AlertRuleEngine";
import { RetentionService } from "./services/monitoring/RetentionService";
import { WebSocketChannelHost } from "./channels/websocket/WebSocketChannelHost";
import { TwilioVoiceChannelHost } from "./channels/twilio-voice/TwilioVoiceChannelHost";
import { CallLogger } from "./services/monitoring/CallLogger";
import { MetricsRegistry } from "./services/monitoring/MetricsRegistry";
import { SecretsManagerRegistry } from "./services/secrets/SecretsManagerRegistry";
import { LocalSecretsManager, LOCAL_SECRETS_MANAGER_NAME } from "./services/secrets/LocalSecretsManager";
import { migrateSecretsToEncrypted } from "./scripts/migrateSecretsToEncrypted";
import { SnapshotSchemaMigrator } from "./services/snapshot/SnapshotSchemaMigrator";
import { VersionService } from "./services/VersionService";

/** Bounded walk of the Error.cause chain (max 4 hops) for log payloads. */
function causeChain(err: unknown): string[] {
  const chain: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = err;
  while (current instanceof Error && chain.length < 4 && !seen.has(current)) {
    seen.add(current);
    chain.push(`${current.name}: ${current.message}`);
    current = (current as { cause?: unknown }).cause;
  }
  return chain;
}

// Last-resort process guards: by default Node 24 exits on unhandled
// rejections with a cryptic dump (in prod, tsx's minified single-line files
// leave frames like "LlmProviderBase.ts:1" — undiagnosable). Log with the
// full cause chain instead. unhandledRejection keeps the process alive (a
// stray rejection must not drop every live conversation); uncaughtException
// exits — state is untrustworthy after an uncaught throw, so let the
// container restart it.
process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  logger.error({ err, causeChain: causeChain(reason) }, 'Unhandled promise rejection (process continues)');
});

process.on('uncaughtException', (err) => {
  logger.error({ err, causeChain: causeChain(err) }, 'Uncaught exception (exiting)');
  process.exit(1);
});

/**
 * Main application entry point - initializes database connection and starts the backend
 */
async function main() {
  // Initialize database connection
  try {
    await db.execute(sql`SELECT 1`);
    logger.info("Database initialized successfully");
  } catch (error) {
    logger.error({ error }, "Failed to initialize database");
    throw error;
  }

  // Encrypt any plain-text secrets left in provider configs or environment passwords.
  // Skipped gracefully when MASTER_ENCRYPTION_KEY is not configured.
  if (process.env.MASTER_ENCRYPTION_KEY) {
    try {
      const registry = container.resolve(SecretsManagerRegistry);
      const localManager = container.resolve(LocalSecretsManager);
      registry.register(LOCAL_SECRETS_MANAGER_NAME, localManager);
      await migrateSecretsToEncrypted(registry);
    } catch (error) {
      logger.error({ error }, "Secrets migration failed — startup aborted");
      throw error;
    }
  } else {
    logger.warn("MASTER_ENCRYPTION_KEY is not set — secrets migration skipped");
  }

  // Validate snapshot migration chain integrity
  try {
    const migrator = container.resolve(SnapshotSchemaMigrator);
    const versionService = container.resolve(VersionService);
    const { restSchemaHash } = versionService.getVersion();
    const chainStatus = migrator.validateChain(restSchemaHash);
    if (!chainStatus.valid) {
      logger.warn(
        { missingTransforms: chainStatus.missing, gapCount: chainStatus.gapCount },
        'Snapshot migration chain has gaps — old snapshots cannot be restored or compared',
      );
    }
  } catch (error) {
    logger.error({ error }, 'Snapshot migration chain validation failed');
  }

  const port = parseInt(process.env.PORT || "3000", 10);
  const server = await startServer(port);

  // Graceful shutdown (P1-09): ordered service stop → HTTP/WS/voice drain →
  // monitoring flush → pool close. Second signal or a stuck step forces exit(1).
  installShutdownHandlers({
    server,
    services: [
      { name: "ConversationTimeoutService", stop: () => container.resolve(ConversationTimeoutService).stop() },
      { name: "ScenarioRunExecutorService", stop: () => container.resolve(ScenarioRunExecutorService).stop() },
      { name: "BenchmarkExecutorService", stop: () => container.resolve(BenchmarkExecutorService).stop() },
      { name: "ImapInboundService", stop: () => container.resolve(ImapInboundService).stop() },
      { name: "OAuth2TokenRefreshService", stop: () => container.resolve(OAuth2TokenRefreshService).stop() },
      { name: "ProcessingDeferralService", stop: () => container.resolve(ProcessingDeferralService).stop() },
      { name: "RetentionService", stop: () => container.resolve(RetentionService).stop() },
      // Stopped before HealthCheckService — the engine consumes its health data.
      { name: "AlertRuleEngine", stop: () => container.resolve(AlertRuleEngine).stop() },
      { name: "HealthCheckService", stop: () => container.resolve(HealthCheckService).stop() },
    ],
    websocketHost: container.resolve(WebSocketChannelHost),
    voiceHost: container.resolve(TwilioVoiceChannelHost),
    callLogger: container.resolve(CallLogger),
    metricsRegistry: container.resolve(MetricsRegistry),
    endPool,
    graceMs: parseEnvInt("SHUTDOWN_GRACE_MS", 10_000),
  });

  logger.info("Bonsai Backend is running...");
}

main().catch((err) => {
  console.error("Error during startup:", err);
  process.exit(1);
});