import { inject, injectable } from 'tsyringe';
import { VersionService } from '../VersionService';
import { logger } from '../../utils/logger';
import { InvalidOperationError } from '../../errors';

/**
 * Entity data structure stored in project_snapshots.entity_data JSONB column.
 * Mirrors ProjectExchangeBundleV1 but preserves provider UUIDs and includes
 * additional entity types (sampleCopies, copyDecorators, testers, scenarios, quickPrompts).
 */
export interface EntityData {
  formatVersion: number;
  restSchemaHash?: string;
  project: Record<string, unknown>;
  agents: unknown[];
  stages: unknown[];
  classifiers: unknown[];
  contextTransformers: unknown[];
  tools: unknown[];
  globalActions: unknown[];
  guardrails: unknown[];
  knowledgeCategories: unknown[];
  knowledgeItems: unknown[];
  sampleCopies: unknown[];
  copyDecorators: unknown[];
  testers: unknown[];
  scenarios: unknown[];
  quickPrompts: unknown[];
  savedSliceQueries: unknown[];
  savedFunnelQueries: unknown[];
}

/**
 * Result of a migration operation.
 */
export interface MigratedEntityData {
  data: EntityData;
  migrated: boolean;
  steps: number;
}

/**
 * A single bidirectional transform for migrating entity_data between schema versions.
 * Each transform corresponds to one database migration that affects snapshot-captured entities.
 */
export interface SnapshotTransform {
  /** The restSchemaHash this transform converts FROM */
  fromHash: string;
  /** The restSchemaHash this transform converts TO */
  toHash: string;
  /** Migration number this corresponds to (e.g., 67) */
  migrationNumber: number;

  /** Forward: old snapshot entity_data → current schema entity_data */
  upgrade(entityData: EntityData): EntityData;

  /** Reverse: current schema entity_data → old snapshot schema entity_data */
  downgrade(entityData: EntityData): EntityData;
}

/**
 * Result of validating the transform chain integrity.
 */
export interface ChainValidationResult {
  valid: boolean;
  currentHash: string;
  oldestHash: string | null;
  gapCount: number;
  missing: { from: string; to: string; migrationNumber: number }[];
}

/**
 * Service that transforms old snapshot entity_data to current schema using a chain
 * of registered transforms. Transforms are registered at startup from migration files.
 *
 * Migration is lazy (on-read): when a snapshot is restored or compared, its entity_data
 * is transformed from the capture-time schema to the current schema if needed.
 */
@injectable()
export class SnapshotSchemaMigrator {
  private readonly transforms = new Map<string, SnapshotTransform>();
  // Ordered chain: fromHash → transform, sorted by migrationNumber
  private sortedTransforms: SnapshotTransform[] = [];
  private chainBuilt = false;

  constructor(
    @inject(VersionService) private readonly versionService: VersionService,
  ) { }

  /**
   * Register a transform. Called at startup from migration registry.
   */
  public register(transform: SnapshotTransform): void {
    this.transforms.set(transform.fromHash, transform);
    this.chainBuilt = false;
    logger.debug(
      { fromHash: transform.fromHash, toHash: transform.toHash, migrationNumber: transform.migrationNumber },
      'Snapshot transform registered',
    );
  }

  /**
   * Build the sorted transform chain lazily.
   */
  private buildChain(): void {
    if (this.chainBuilt) return;
    this.sortedTransforms = [...this.transforms.values()].sort((a, b) => a.migrationNumber - b.migrationNumber);
    this.chainBuilt = true;
  }

  /**
   * Check if a snapshot hash is compatible with the current schema.
   */
  public isCompatible(snapshotHash: string | undefined | null): boolean {
    if (!snapshotHash) return false; // No hash means pre-schema-tracking (unknown)
    const currentHash = this.versionService.getVersion().restSchemaHash;
    return snapshotHash === currentHash;
  }

  /**
   * Get the schema status for a snapshot.
   */
  public getSchemaStatus(snapshotHash: string | undefined | null): {
    status: 'compatible' | 'incompatible' | 'unknown';
    message: string | null;
  } {
    const currentHash = this.versionService.getVersion().restSchemaHash;

    if (!snapshotHash) {
      return {
        status: 'unknown',
        message: 'Snapshot was created before schema hash tracking. Restore and compare are not available.',
      };
    }

    if (snapshotHash === currentHash) {
      return { status: 'compatible', message: null };
    }

    // Check if migration chain exists
    const chain = this.getUpgradeChain(snapshotHash, currentHash);
    if (chain.transforms.length === 0 && !this.isCompatible(snapshotHash)) {
      return {
        status: 'incompatible',
        message: `Snapshot was created before database schema v${chain.oldestMigration || 'unknown'}. Restore and compare require migration, but transform chain is broken.`,
      };
    }

    return {
      status: 'incompatible',
      message: `Snapshot was created before database schema changes. Auto-migration will be applied (${chain.transforms.length} transform step${chain.transforms.length !== 1 ? 's' : ''}).`,
    };
  }

  /**
   * Build the upgrade chain from sourceHash to currentHash.
   * Returns the chain of transforms and metadata.
   */
  private getUpgradeChain(sourceHash: string, targetHash: string): {
    transforms: SnapshotTransform[];
    oldestMigration: number | null;
    broken: boolean;
  } {
    this.buildChain();

    if (sourceHash === targetHash) {
      return { transforms: [], oldestMigration: null, broken: false };
    }

    const chain: SnapshotTransform[] = [];
    let current = sourceHash;
    let oldestMigration: number | null = null;

    // Walk the chain from source toward target
    for (let i = 0; i < 100; i++) { // Safety limit
      if (current === targetHash) break;

      const transform = this.transforms.get(current);
      if (!transform) {
        // Chain is broken — find the oldest available migration
        if (this.sortedTransforms.length > 0) {
          oldestMigration = this.sortedTransforms[0].migrationNumber;
        }
        return { transforms: chain, oldestMigration, broken: true };
      }

      if (oldestMigration === null || transform.migrationNumber < oldestMigration) {
        oldestMigration = transform.migrationNumber;
      }

      chain.push(transform);
      current = transform.toHash;
    }

    // If we didn't reach targetHash, chain is broken
    if (current !== targetHash) {
      return { transforms: chain, oldestMigration, broken: true };
    }

    return { transforms: chain, oldestMigration, broken: false };
  }

  /**
   * Migrate entity_data from the snapshot's hash to the current hash.
   * Returns { data, migrated: true/false, steps: number }.
   * Throws InvalidOperationError if migration chain is broken.
   */
  public migrateToCurrent(entityData: EntityData, sourceHash: string | undefined | null, currentHash: string): MigratedEntityData {
    // No hash or already compatible
    if (!sourceHash || sourceHash === currentHash) {
      return { data: entityData, migrated: false, steps: 0 };
    }

    const chain = this.getUpgradeChain(sourceHash, currentHash);

    if (chain.broken) {
      throw new InvalidOperationError(
        `Snapshot cannot be migrated to current schema. Transform chain is broken. ` +
        `Oldest available migration: ${chain.oldestMigration || 'unknown'}.`,
      );
    }

    let data = structuredClone(entityData);
    let steps = 0;

    for (const transform of chain.transforms) {
      data = transform.upgrade(data);
      steps++;
      logger.debug(
        { migrationNumber: transform.migrationNumber, fromHash: transform.fromHash, toHash: transform.toHash },
        'Snapshot transform applied',
      );
    }

    return { data, migrated: steps > 0, steps };
  }

  /**
   * Validate the transform chain integrity at startup.
   */
  public validateChain(currentHash: string): ChainValidationResult {
    this.buildChain();

    if (this.sortedTransforms.length === 0) {
      return {
        valid: true,
        currentHash,
        oldestHash: null,
        gapCount: 0,
        missing: [],
      };
    }

    // Find the oldest hash (first transform's fromHash)
    const oldestHash = this.sortedTransforms[0].fromHash;

    // Walk from oldest to current, checking for gaps
    const missing: { from: string; to: string; migrationNumber: number }[] = [];
    let current = oldestHash;

    for (let i = 0; i < 100; i++) {
      if (current === currentHash) break;

      const transform = this.transforms.get(current);
      if (!transform) {
        // Estimate the missing migration number
        const prevTransform = i > 0 ? this.sortedTransforms.find(t => t.migrationNumber < (this.sortedTransforms[i - 1]?.migrationNumber || 0)) : null;
        const estimatedMigration = prevTransform
          ? prevTransform.migrationNumber + 1
          : (this.sortedTransforms[0]?.migrationNumber || 0) - (i + 1);
        missing.push({
          from: current,
          to: 'unknown',
          migrationNumber: estimatedMigration,
        });
        break;
      }

      current = transform.toHash;
    }

    return {
      valid: missing.length === 0 && current === currentHash,
      currentHash,
      oldestHash,
      gapCount: missing.length,
      missing,
    };
  }
}
