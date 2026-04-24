import { singleton } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { db } from '../../db/index';
import { secrets } from '../../db/schema';
import { encryptSecret, decryptSecret, parseMasterKey } from '../../utils/crypto';
import { generateId } from '../../utils/idGenerator';
import { NotFoundError, NotConfiguredError } from '../../errors';
import { logger } from '../../utils/logger';
import type { ISecretsManager } from './ISecretsManager';

/** Name this manager registers under in the SecretsManagerRegistry */
export const LOCAL_SECRETS_MANAGER_NAME = 'local';

/**
 * Secrets manager backed by the local database.
 * Encrypts values with AES-256-GCM using a master key from the MASTER_ENCRYPTION_KEY env var.
 * Produces and resolves references in the form `@sec:local:id`.
 */
@singleton()
export class LocalSecretsManager implements ISecretsManager {
  private readonly masterKey: Buffer;
  private readonly name = LOCAL_SECRETS_MANAGER_NAME;

  constructor() {
    const raw = process.env.MASTER_ENCRYPTION_KEY;
    if (!raw) {
      throw new NotConfiguredError('MASTER_ENCRYPTION_KEY environment variable is required for the local secrets manager. Generate a 32-byte key with: openssl rand -hex 32');
    }
    this.masterKey = parseMasterKey(raw);
  }

  /**
   * Encrypts a plaintext value, stores it in the DB, and returns an `@sec:local:id` reference.
   * @param value - The plaintext secret to store
   * @returns Opaque reference string
   */
  async storeSecret(value: string): Promise<string> {
    const id = generateId('sec');
    const { encryptedValue, iv, tag } = encryptSecret(value, this.masterKey);
    await db.insert(secrets).values({ id, encryptedValue, iv, tag });
    logger.debug({ secretId: id }, 'Secret stored');
    return this.toRef(id);
  }

  /**
   * Resolves an `@sec:local:id` reference to its plaintext value.
   * @param ref - The opaque reference string
   * @returns Decrypted plaintext
   * @throws {NotFoundError} If the secret row does not exist
   */
  async resolveSecret(ref: string): Promise<string> {
    const id = this.extractId(ref);
    const row = await db.query.secrets.findFirst({ where: eq(secrets.id, id) });
    if (!row) {
      throw new NotFoundError(`Secret ${ref} not found`);
    }
    return decryptSecret(row.encryptedValue, row.iv, row.tag, this.masterKey);
  }

  /**
   * Deletes a stored secret by its reference string.
   * @param ref - The opaque reference string
   * @throws {NotFoundError} If the secret row does not exist
   */
  async deleteSecret(ref: string): Promise<void> {
    const id = this.extractId(ref);
    const deleted = await db.delete(secrets).where(eq(secrets.id, id)).returning();
    if (deleted.length === 0) {
      throw new NotFoundError(`Secret ${ref} not found`);
    }
    logger.debug({ secretId: id }, 'Secret deleted');
  }

  /**
   * Returns all secret IDs stored by this manager (bare IDs without prefix).
   */
  async listIds(): Promise<string[]> {
    const rows = await db.query.secrets.findMany({ columns: { id: true } });
    return rows.map(r => r.id);
  }

  private toRef(id: string): string {
    return `@sec:${this.name}:${id}`;
  }

  private extractId(ref: string): string {
    const parts = ref.split(':');
    return parts[2]!;
  }
}
