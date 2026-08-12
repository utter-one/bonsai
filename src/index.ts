import "reflect-metadata";
import "dotenv/config";
import { db } from "./db/index";
import logger from "./utils/logger";
import { sql } from "drizzle-orm";
import { container } from "tsyringe";
import { startServer } from "./server";
import { SecretsManagerRegistry } from "./services/secrets/SecretsManagerRegistry";
import { LocalSecretsManager, LOCAL_SECRETS_MANAGER_NAME } from "./services/secrets/LocalSecretsManager";
import { migrateSecretsToEncrypted } from "./scripts/migrateSecretsToEncrypted";
import { SnapshotSchemaMigrator } from "./services/snapshot/SnapshotSchemaMigrator";
import { VersionService } from "./services/VersionService";

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
  await startServer(port);

  logger.info("Bonsai Backend is running...");
}

main().catch((err) => {
  console.error("Error during startup:", err);
  process.exit(1);
});