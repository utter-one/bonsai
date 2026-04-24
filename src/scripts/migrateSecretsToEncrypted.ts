/**
 * Migration script: Encrypt plain-text secrets in provider configs and environment passwords.
 *
 * This script scans all provider.config JSONB objects and environment.password fields for
 * plain-text values at known sensitive keys and encrypts them using the local secrets manager.
 * It is idempotent — already-encrypted values (those matching @sec:*) are skipped.
 *
 * Also exported as `migrateSecretsToEncrypted` for use during application startup.
 *
 * Prerequisites:
 *   - MASTER_ENCRYPTION_KEY env var must be set
 *   - DB_CONNECTION_STRING env var must be set
 *   - Migrations must be up to date (npm run db:migrate)
 */
import 'reflect-metadata';
import { container } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { db } from '../db/index';
import { providers, environments } from '../db/schema';
import { SecretsManagerRegistry } from '../services/secrets/SecretsManagerRegistry';
import { LocalSecretsManager, LOCAL_SECRETS_MANAGER_NAME } from '../services/secrets/LocalSecretsManager';
import { SENSITIVE_PROVIDER_CONFIG_FIELDS } from '../services/secrets/SecretRefUtils';
import { logger } from '../utils/logger';

/** Scans sensitive fields in an object and returns plain-text field names (no DB writes). */
function scanObject(obj: Record<string, unknown>, registry: SecretsManagerRegistry): string[] {
  const fields: string[] = [];
  for (const key of SENSITIVE_PROVIDER_CONFIG_FIELDS) {
    const value = obj[key];
    if (typeof value === 'string' && value.length > 0 && !registry.isSecretReference(value)) {
      fields.push(key);
    }
  }
  return fields;
}

/**
 * Scans all provider configs and environment passwords for plain-text sensitive values
 * and encrypts them using the provided secrets registry. Idempotent — already-encrypted
 * values are skipped. Intended to be called both from the standalone CLI script and
 * automatically on application startup.
 */
export async function migrateSecretsToEncrypted(registry: SecretsManagerRegistry): Promise<void> {
  const pendingProviders: Array<{ id: string; name: string; config: Record<string, unknown>; fields: string[] }> = [];
  const pendingEnvs: Array<{ id: string; description: string; password: string }> = [];

  const allProviders = await db.select({ id: providers.id, name: providers.name, config: providers.config }).from(providers);
  for (const row of allProviders) {
    const config = (row.config ?? {}) as Record<string, unknown>;
    const fields = scanObject(config, registry);
    if (fields.length > 0) {
      pendingProviders.push({ id: row.id, name: row.name, config, fields });
    }
  }

  const allEnvs = await db.select({ id: environments.id, description: environments.description, password: environments.password }).from(environments);
  for (const row of allEnvs) {
    if (row.password && typeof row.password === 'string' && !registry.isSecretReference(row.password)) {
      pendingEnvs.push({ id: row.id, description: row.description, password: row.password });
    }
  }

  const totalChanges = pendingProviders.reduce((s, p) => s + p.fields.length, 0) + pendingEnvs.length;

  if (totalChanges === 0) {
    logger.info('Secrets migration: nothing to migrate — all secrets are already encrypted');
    return;
  }

  logger.info({ providers: pendingProviders.length, environments: pendingEnvs.length, totalFields: totalChanges }, 'Secrets migration: encrypting plain-text secrets');

  for (const p of pendingProviders) {
    const updated = { ...p.config };
    for (const key of p.fields) {
      updated[key] = await registry.storeSecret(LOCAL_SECRETS_MANAGER_NAME, updated[key] as string);
    }
    await db.update(providers).set({ config: updated }).where(eq(providers.id, p.id));
    logger.info({ providerId: p.id, providerName: p.name, fields: p.fields }, 'Secrets migration: provider fields encrypted');
  }

  for (const e of pendingEnvs) {
    const ref = await registry.storeSecret(LOCAL_SECRETS_MANAGER_NAME, e.password);
    await db.update(environments).set({ password: ref }).where(eq(environments.id, e.id));
    logger.info({ environmentId: e.id, description: e.description }, 'Secrets migration: environment password encrypted');
  }

  logger.info({ totalFields: totalChanges }, 'Secrets migration complete');
}

async function run(): Promise<void> {
  const registry = container.resolve(SecretsManagerRegistry);
  const localManager = container.resolve(LocalSecretsManager);
  registry.register(LOCAL_SECRETS_MANAGER_NAME, localManager);
  await migrateSecretsToEncrypted(registry);
}

run().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
