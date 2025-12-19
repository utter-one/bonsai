import "dotenv/config";
import "./container"; // Initialize DI container
import { db } from "./db/index";
import logger from "./utils/logger";
import { sql } from "drizzle-orm";
import { startServer } from "./server";

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

  const port = parseInt(process.env.PORT || "3000", 10);
  startServer(port);

  logger.info("Nexus backend is running...");
}

main().catch((err) => {
  console.error("Error during startup:", err);
  process.exit(1);
});