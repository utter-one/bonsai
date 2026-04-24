import type { InjectionToken } from 'tsyringe';
import { SecretsManagerRegistry } from './SecretsManagerRegistry';

/**
 * Interface for a secrets manager backend.
 * Implementations must be registered in the SecretsManagerRegistry under a name.
 */
export type ISecretsManager = {
  /**
   * Encrypts a plaintext value, stores it, and returns an `@sec:name:id` reference string.
   * @param value - The plaintext secret to store
   * @returns An opaque reference string in the form `@sec:name:id`
   */
  storeSecret(value: string): Promise<string>;

  /**
   * Resolves an `@sec:name:id` reference to its plaintext value.
   * @param ref - The opaque reference string
   * @returns The decrypted plaintext value
   * @throws {NotFoundError} If the secret does not exist
   */
  resolveSecret(ref: string): Promise<string>;

  /**
   * Deletes a stored secret by its reference string.
   * @param ref - The opaque reference string
   * @throws {NotFoundError} If the secret does not exist
   */
  deleteSecret(ref: string): Promise<void>;

  /**
   * Returns all secret IDs managed by this backend (bare IDs without `@sec:name:` prefix).
   */
  listIds(): Promise<string[]>;
};

/** Injection token for the SecretsManagerRegistry singleton */
export const ISecretsManagerRegistryToken: InjectionToken<SecretsManagerRegistry> = 'ISecretsManagerRegistry';
