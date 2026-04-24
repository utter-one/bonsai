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

  const port = parseInt(process.env.PORT || "3000", 10);
  startServer(port);

  logger.info("Bonsai Backend is running...");
}

main().catch((err) => {
  console.error("Error during startup:", err);
  process.exit(1);
});