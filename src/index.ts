import "dotenv/config";
import { db } from "./db/index";
import logger from "./utils/logger";
import { sql } from "drizzle-orm";

async function main() {
  // Initialize database connection
  try {
    await db.execute(sql`SELECT 1`);
    logger.info("Database initialized successfully");
  } catch (error) {
    logger.error({ error }, "Failed to initialize database");
    throw error;
  }

  console.log("Nexus backend is running...");
  // Additional startup logic can be added here
}

main().catch((err) => {
  console.error("Error during startup:", err);
  process.exit(1);
});