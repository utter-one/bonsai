import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from '../../src/db/schema';

let sqliteDb: Database | null = null;
let drizzleDb: ReturnType<typeof drizzle<Record<string, never>>> | null = null;

export function getTestDb() {
  if (!sqliteDb) {
    sqliteDb = new Database(':memory:');
  }
  if (!drizzleDb) {
    drizzleDb = drizzle(sqliteDb, { schema });
  }
  return drizzleDb;
}

export function resetTestDb() {
  if (sqliteDb) {
    sqliteDb.close();
    sqliteDb = null;
  }
  drizzleDb = null;
}
