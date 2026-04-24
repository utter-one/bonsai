import { singleton } from 'tsyringe';
import type { ISecretsManager } from './ISecretsManager';
import { InvalidOperationError, NotFoundError } from '../../errors';
import { logger } from '../../utils/logger';

/** Regex matching an `@sec:name:id` reference — name and id may contain alphanumeric chars, hyphens, underscores, dots */
const SECRET_REF_PATTERN = /^@sec:[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+$/;

/**
 * Central registry that routes `@sec:name:id` references to the correct ISecretsManager backend.
 * Inject this class wherever secrets need to be stored or resolved.
 * Register backends at startup with `register(name, manager)`.
 */
@singleton()
export class SecretsManagerRegistry {
  private readonly managers = new Map<string, ISecretsManager>();

  /**
   * Registers a named secrets manager backend.
   * @param name - The manager name used in reference strings (e.g. `"local"`)
   * @param manager - The backend implementation
   */
  register(name: string, manager: ISecretsManager): void {
    this.managers.set(name, manager);
    logger.info({ managerName: name }, 'Secrets manager registered');
  }

  /**
   * Returns true if the value is a valid `@sec:name:id` reference.
   */
  isSecretReference(value: unknown): value is string {
    return typeof value === 'string' && SECRET_REF_PATTERN.test(value);
  }

  /**
   * Stores a secret value using the named manager and returns an `@sec:name:id` reference.
   * @param managerName - The registered manager name (e.g. `"local"`)
   * @param value - The plaintext secret value to store
   * @returns Opaque reference string
   */
  async storeSecret(managerName: string, value: string): Promise<string> {
    const manager = this.getManager(managerName);
    return manager.storeSecret(value);
  }

  /**
   * Resolves an `@sec:name:id` reference to its plaintext value.
   * @param ref - The opaque reference string
   * @returns Decrypted plaintext value
   * @throws {NotFoundError} If the backend or secret does not exist
   */
  async resolveSecret(ref: string): Promise<string> {
    const { name } = this.parseRef(ref);
    const manager = this.getManager(name);
    return manager.resolveSecret(ref);
  }

  /**
   * Deletes a stored secret by its reference string.
   * @param ref - The opaque reference string
   * @throws {NotFoundError} If the backend or secret does not exist
   */
  async deleteSecret(ref: string): Promise<void> {
    const { name } = this.parseRef(ref);
    const manager = this.getManager(name);
    return manager.deleteSecret(ref);
  }

  /**
   * Lists all secrets across all registered backends as `@sec:name:id` reference strings.
   */
  async listAllRefs(): Promise<string[]> {
    const refs: string[] = [];
    for (const [name, manager] of this.managers) {
      const ids = await manager.listIds();
      for (const id of ids) {
        refs.push(`@sec:${name}:${id}`);
      }
    }
    return refs;
  }

  /**
   * Returns the default (first registered) manager name, used when storing new secrets.
   * @throws {InvalidOperationError} If no managers are registered
   */
  get defaultManagerName(): string {
    const first = this.managers.keys().next();
    if (first.done) {
      throw new InvalidOperationError('No secrets managers registered. Ensure a manager is registered before storing secrets.');
    }
    return first.value;
  }

  private getManager(name: string): ISecretsManager {
    const manager = this.managers.get(name);
    if (!manager) {
      throw new NotFoundError(`Secrets manager "${name}" is not registered`);
    }
    return manager;
  }

  private parseRef(ref: string): { name: string; id: string } {
    const parts = ref.split(':');
    return { name: parts[1]!, id: parts[2]! };
  }
}
