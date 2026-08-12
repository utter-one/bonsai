# Project Versioning — Specification v1

## 1. Problem Statement

Users need a way to track and compare changes to their projects over time. Common scenarios:

- **Prompt comparison**: An operator changes a stage's prompt and wants to compare it against the previous version quickly, without copy-paste operations.
- **Rollback**: A change broke conversations and the operator needs to restore a known-good configuration.
- **Change tracking**: Understanding what changed between two points in time across the full project (agents, stages, classifiers, tools, etc.).
- **Audit trail**: Knowing who changed what and when, beyond per-entity audit logs.

## 2. Core Concept

A **Project Snapshot** is an immutable, point-in-time record of the complete configuration of a single project. Each snapshot captures all configurable entities (agents, stages, classifiers, etc.) as a structured JSON document. Snapshots are identified by a sequential version number (`v1`, `v2`, …) and an optional human-readable name.

### 2.1 Key Design Decisions

| Decision | Rationale |
|---|---|
| **Snapshot-based, not per-entity diffs** | Simpler storage, reliable restore, easy comparison. Per-entity diff tables would need complex FK management across versions. |
| **JSONB storage for entity data** | PostgreSQL JSONB supports indexed queries; entities have varying schemas (tools have 3 types). |
| **Sequential version numbers** | Simple, intuitive for users. No ambiguity about ordering. |
| **Snapshots are immutable** | Once created, a snapshot cannot be modified or deleted by the operator. This preserves the integrity of the version history. System can prune old snapshots via retention policy. |
| **Provider references stored as UUIDs** | Unlike exchange bundles, snapshots are local-only — provider UUIDs are preserved as-is. If a provider is deleted, the reference becomes stale (documented behavior). |
| **No runtime data** | Snapshots exclude conversations, users, artifacts, issues, scenario runs, etc. Only configuration entities are captured. |
| **No per-entity optimistic locking** | Snapshots are read-only records. The `version` field on entities is captured as-is at snapshot time. |

## 3. Entities Captured

The following entities are captured in a snapshot. This goes beyond `ProjectExchangeService.exportProject()` which only captures 10 entity types — snapshots capture all 15 project-scoped configuration entities:

| Entity | Table | Notes |
|---|---|---|
| Project config | `projects` | Full row minus runtime fields (`version`, `archivedAt`, `archivedBy`) |
| Agents | `agents` | Including `fillerSettings` |
| Stages | `stages` | Including `actions`, `globalActions`, `transformerIds`, etc. |
| Classifiers | `classifiers` | |
| Context Transformers | `context_transformers` | |
| Tools | `tools` | All 3 types: smart_function, webhook, script |
| Global Actions | `global_actions` | |
| Guardrails | `guardrails` | |
| Knowledge Categories | `knowledge_categories` | |
| Knowledge Items | `knowledge_items` | Linked to categories |
| Sample Copies | `sample_copies` | Not in exchange bundle |
| Copy Decorators | `copy_decorators` | Not in exchange bundle |
| Testers | `testers` | Not in exchange bundle |
| Scenarios | `scenarios` | Not in exchange bundle |
| Quick Prompts | `quick_prompts` | Only project-scoped (`projectId` IS NOT NULL); not in exchange bundle |

### Excluded (runtime data)

- `conversations`, `conversation_events`, `conversation_artifacts` — runtime session data
- `users` — end-user accounts
- `api_keys` — credentials; never snapshot
- `issues` — bug reports
- `scenario_runs`, `scenario_conversations` — test execution history
- `saved_slice_queries`, `saved_funnel_queries` — analytics queries
- `deferred_processing` — message queue
- `benchmark_*` tables — benchmarking is global, not project-scoped

## 4. Database Schema

### 4.1 `project_snapshots` Table

```ts
export const projectSnapshots = pgTable('project_snapshots', {
  id: text('id').primaryKey(),                          // proj_snap_{uuidv7}
  projectId: text('project_id').notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),                // sequential: 1, 2, 3, ...
  name: text('name'),                                   // optional operator label
  entityData: jsonb('entity_data').notNull(),           // full snapshot payload
  createdBy: text('created_by').references(() => operators.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  // Enforce unique version per project
  uniqueIndex('project_snapshots_project_id_version_unique')
    .on(table.projectId, table.version),
  // Fast lookup for listing versions of a project
  index('idx_project_snapshots_project_id').on(table.projectId),
]);
```

### 4.2 `entity_data` JSONB Structure

The `entity_data` column mirrors the structure of `ProjectExchangeBundleV1` but **preserves provider UUIDs** (no hint conversion) and **includes all fields** (including `version`, `createdAt`, `updatedAt` for reference):

```jsonc
{
  "formatVersion": 1,
  "project": { /* full projects row minus archivedAt, archivedBy */ },
  "agents": [ /* full agents rows */ ],
  "stages": [ /* full stages rows */ ],
  "classifiers": [ /* full classifiers rows */ ],
  "contextTransformers": [ /* full contextTransformers rows */ ],
  "tools": [ /* full tools rows */ ],
  "globalActions": [ /* full globalActions rows */ ],
  "guardrails": [ /* full guardrails rows */ ],
  "knowledgeCategories": [ /* full knowledgeCategories rows */ ],
  "knowledgeItems": [ /* full knowledgeItems rows */ ],
  "sampleCopies": [ /* full sampleCopies rows */ ],
  "copyDecorators": [ /* full copyDecorators rows */ ],
  "testers": [ /* full testers rows */ ],
  "scenarios": [ /* full scenarios rows */ ],
  "quickPrompts": [ /* full quickPrompts rows with projectId */ ]
}
```

### 4.3 Schema Versioning in Snapshots

Each snapshot stores the **REST schema hash** at capture time. This is the same hash used by `MigrationService` to detect cross-instance schema mismatches:

```ts
// Captured during createSnapshot, read from VersionService
const { restSchemaHash } = this.versionService.getVersion();
```

The `entity_data` JSONB includes this hash:

```jsonc
{
  "formatVersion": 1,
  "restSchemaHash": "a1b2c3...",   // schema hash at capture time
  "project": { ... },
  "agents": [ ... ],
  ...
}
```

**Why this matters:** The `restSchemaHash` is a SHA-256 hash (truncated to 12 hex chars) of the **OpenAPI spec**, not the raw DB schema. This is the correct signal: the hash changes when API contracts change (new endpoint, changed request/response shape, added/renamed field in a contract), which is exactly when the snapshot's `entity_data` format diverges. Internal-only DB columns that don't appear in API contracts won't trigger a hash change — and they shouldn't, because the snapshot data format didn't actually change.

Old snapshots carry the *previous* hash, signaling that their `entity_data` may not match the current API contract. This hash is checked on **restore** and **compare** to determine if transformation is needed.

## 5. API Endpoints

All endpoints require JWT authentication. Permission checks follow the defense-in-depth pattern (controller + service).

### 5.1 Create Snapshot

**`POST /api/projects/:id/snapshots`**

Create a new snapshot of the project at the current point in time. Version number is auto-incremented.

**Request:**
```json
{
  "name": "Before changing stage prompts"  // optional
}
```

**Response (201):**
```json
{
  "id": "proj_snap_019c...",
  "projectId": "proj_019c...",
  "version": 3,
  "name": "Before changing stage prompts",
  "createdBy": "oper_019c...",
  "createdAt": "2025-01-15T10:30:00.000Z",
  "entityCounts": {
    "agents": 2,
    "stages": 5,
    "classifiers": 3,
    "contextTransformers": 1,
    "tools": 4,
    "globalActions": 6,
    "guardrails": 2,
    "knowledgeCategories": 3,
    "knowledgeItems": 12,
    "sampleCopies": 0,
    "copyDecorators": 0,
    "testers": 1,
    "scenarios": 0,
    "quickPrompts": 0
  }
}
```

**Permissions:** `PROJECT_WRITE`

**Error cases:**
- 404 — Project not found
- 403 — Insufficient permissions
- 409 — Project is archived

### 5.2 List Snapshots

**`GET /api/projects/:id/snapshots`**

List all snapshots for a project, ordered by version descending.

**Query Parameters:**
- `offset` (number, default 0)
- `limit` (number, default 50, max 200)
- `textSearch` (string) — searches `name` field

**Response (200):**
```json
{
  "items": [
    {
      "id": "proj_snap_019c...",
      "version": 3,
      "name": "Before changing stage prompts",
      "createdBy": "oper_019c...",
      "createdAt": "2025-01-15T10:30:00.000Z",
      "entityCounts": { "agents": 2, "stages": 5, ... }
    }
  ],
  "total": 3,
  "offset": 0,
  "limit": 50
}
```

**Permissions:** `PROJECT_READ`

### 5.3 Get Snapshot

**`GET /api/projects/:id/snapshots/:snapshotId`**

Retrieve a single snapshot with its full entity data.

**Response (200):**
```json
{
  "id": "proj_snap_019c...",
  "projectId": "proj_019c...",
  "version": 3,
  "name": "Before changing stage prompts",
  "createdBy": "oper_019c...",
  "createdAt": "2025-01-15T10:30:00.000Z",
  "entityData": {
    "formatVersion": 1,
    "project": { ... },
    "agents": [ ... ],
    "stages": [ ... ],
    ...
  }
}
```

**Permissions:** `PROJECT_READ`

### 5.4 Get Snapshot by Version

**`GET /api/projects/:id/snapshots/version/:version`**

Retrieve a snapshot by its sequential version number.

**Response (200):** Same as Get Snapshot above.

**Permissions:** `PROJECT_READ`

### 5.5 Compare Snapshots

**`GET /api/projects/:id/snapshots/compare`**

Compare two snapshots and return a structured diff. This is the primary comparison endpoint — the feature's core use case.

**Query Parameters:**
- `fromVersion` (number, required) — baseline version
- `toVersion` (number, required) — target version to compare against

**Response (200):**
```json
{
  "fromVersion": 2,
  "toVersion": 3,
  "summary": {
    "entitiesAdded": ["stag_019c_new_stage"],
    "entitiesRemoved": [],
    "entitiesModified": ["stag_019c_main_stage", "agnt_019c_main_agent"],
    "entitiesUnchanged": 15
  },
  "diffs": [
    {
      "entityType": "stage",
      "entityId": "stag_019c_main_stage",
      "entityName": "Main Conversation",
      "changes": [
        {
          "field": "prompt",
          "from": "You are a helpful assistant...",
          "to": "You are a friendly customer service assistant..."
        },
        {
          "field": "llmSettings.model",
          "from": "gpt-4o-mini",
          "to": "gpt-4o"
        }
      ]
    },
    {
      "entityType": "agent",
      "entityId": "agnt_019c_main_agent",
      "entityName": "Main Agent",
      "changes": [
        {
          "field": "prompt",
          "from": "You are a bot...",
          "to": "You are a helpful bot..."
        }
      ]
    }
  ],
  "added": [
    {
      "entityType": "stage",
      "entity": { "id": "stag_019c_new", "name": "New Stage", ... }
    }
  ],
  "removed": []
}
```

**Diff Algorithm:**
- Entities are matched by their `id` field within each entity type array.
- For each matched entity, a deep comparison walks all fields (including nested objects).
- Only fields with different values are reported.
- Fields using dot notation (`llmSettings.model`) indicate nested paths.
- Arrays are compared as whole values (not element-by-element).
- Runtime fields (`version`, `createdAt`, `updatedAt`) are **excluded** from diffs since they change on every snapshot regardless of actual configuration changes.

**Error cases:**
- 400 — `fromVersion` equals `toVersion`, or one/both versions don't exist
- 404 — Project not found

**Permissions:** `PROJECT_READ`

### 5.6 Update Snapshot Name

**`PATCH /api/projects/:id/snapshots/:snapshotId`**

Update the human-readable name of an existing snapshot.

**Request:**
```json
{
  "name": "Pre-prompt-experiment-2025-01-15"
}
```

**Response (200):** Full snapshot metadata (no entityData).

**Permissions:** `PROJECT_WRITE`

### 5.7 Restore from Snapshot

**`POST /api/projects/:id/snapshots/:snapshotId/restore`**

Restore a project's configuration to match a previous snapshot. This deletes all current child entities and re-creates them from the snapshot data.

**Request:** None (body not required)

**Response (200):**
```json
{
  "restored": true,
  "snapshotVersion": 2,
  "entityCounts": {
    "agents": 2,
    "stages": 5,
    ...
  }
}
```

**Permissions:** `PROJECT_WRITE`

**Constraints:**
- Project must not be archived.
- Active conversations are **not** affected (they reference entity IDs by value).
- Provider UUIDs in the snapshot must still exist; if a provider was deleted, the reference is set to `null` and reported in the response.
- The restore operation is wrapped in a DB transaction.
- A new snapshot is **automatically created** before restore (backup of the pre-restore state).

**Restore Response with Warnings:**
```json
{
  "restored": true,
  "snapshotVersion": 2,
  "entityCounts": { ... },
  "warnings": [
    {
      "type": "stale_provider_reference",
      "entityType": "agent",
      "entityId": "agnt_019c...",
      "entityName": "Main Agent",
      "field": "ttsProviderId",
      "message": "TTS provider prov_019c... no longer exists; field set to null"
    }
  ]
}
```

### 5.8 Delete Snapshot

**`DELETE /api/projects/:id/snapshots/:snapshotId`**

Delete a single snapshot. This is a destructive action — once deleted, the snapshot data is gone.

**Response (200):**
```json
{
  "deleted": true,
  "snapshotId": "proj_snap_019c..."
}
```

**Permissions:** `PROJECT_WRITE`

**Constraints:**
- Cannot delete the only remaining snapshot if the operator has `PROJECT_READ` only.
- Version numbers are **not** renumbered after deletion (gaps are allowed).
- Next snapshot creation uses `MAX(version) + 1`.

### 5.9 Snapshot Schema Compatibility Status

Every snapshot carries its capture-time `restSchemaHash`. The API exposes a **compatibility status** on list/get responses so the UI can surface warnings:

```json
{
  "id": "proj_snap_019c...",
  "version": 2,
  "name": "Before changes",
  "createdBy": "oper_019c...",
  "createdAt": "2025-01-10T08:00:00.000Z",
  "schemaHash": "a1b2c3...",
  "schemaStatus": "incompatible",
  "schemaStatusMessage": "Snapshot was created before database schema v63. Restore and compare require migration.",
  "entityCounts": { ... }
}
```

| `schemaStatus` | Meaning | Restore | Compare |
|---|---|---|---|
| `compatible` | Snapshot hash matches current schema | Allowed | Allowed |
| `incompatible` | Snapshot hash differs from current schema | Requires migration first | Requires migration first |
| `unknown` | Snapshot predates schema hash tracking (formatVersion < 1) | Blocked | Blocked |

## 6. Data Migration Strategy

### 6.1 The Problem

When the database schema changes between snapshots, stored JSONB data becomes structurally incompatible with the current schema. Examples:

| Change | Impact on Old Snapshots |
|---|---|
| **New column added** (e.g., `recordingConfig` on projects) | Old snapshots miss the field → restore would set it to `NULL` instead of default |
| **Column renamed** (e.g., `promptTrigger` → `triggerPhrase`) | Old snapshots have `promptTrigger` → restore fails on unknown column |
| **Column type changed** (e.g., `text[]` → `jsonb`) | Old snapshots have wrong format → restore inserts invalid data |
| **Entity removed from schema** (e.g., `copyDecorators` table dropped) | Old snapshots contain entity → restore inserts into non-existent table |
| **Nested object structure changed** (e.g., `asrConfig.serverVad.algorithm` enum values changed) | Old snapshots have stale enum → restore may violate CHECK constraint |

### 6.2 Migration Approach: Schema-Driven Transforms

Snapshots are migrated **on-read** (lazy), not on-write. This avoids expensive batch jobs and keeps the migration logic close to the consumer.

**Core principle:** A **SnapshotSchemaMigrator** service transforms old snapshot `entity_data` from the capture-time schema to the current schema using a chain of transform functions, one per schema version.

```
Old snapshot (hash: v60) → transform v60→v61 → v61→v62 → ... → v66→current → compatible data
```

### 6.3 Transform Registry

Each database migration that affects snapshot-captured entities registers a **bidirectional transform**:

```ts
// src/services/snapshot/SnapshotSchemaMigrator.ts

export interface SnapshotTransform {
  /** The restSchemaHash this transform converts FROM */
  fromHash: string;
  /** The restSchemaHash this transform converts TO */
  toHash: string;
  /** Migration number this corresponds to (e.g., 63) */
  migrationNumber: number;

  /**
   * Forward: old snapshot entity_data → current schema entity_data.
   * Called during restore/compare to make old data compatible.
   */
  upgrade(entityData: EntityData): EntityData;

  /**
   * Reverse: current schema entity_data → old snapshot schema entity_data.
   * Called during createSnapshot when migrating existing snapshots backward
   * (not used in v1, reserved for future backward-compat features).
   */
  downgrade(entityData: EntityData): EntityData;
}

@injectable()
export class SnapshotSchemaMigrator {
  private readonly transforms = new Map<string, SnapshotTransform>();

  /** Register a transform (called at startup from migration registry) */
  register(transform: SnapshotTransform): void;

  /**
   * Migrate entity_data from the snapshot's hash to the current hash.
   * Returns { data, migrated: true/false, steps: number }.
   * Throws InvalidOperationError if migration chain is broken.
   */
  migrateToCurrent(entityData: EntityData, sourceHash: string, currentHash: string): MigratedEntityData;

  /** Check if a snapshot hash is compatible with current schema */
  isCompatible(snapshotHash: string): boolean;
}
```

### 6.4 Transform Registration Flow

Transforms are registered at startup, **before** controllers are resolved. The registration source is the **Drizzle migration files** themselves — each migration that affects snapshot entities includes a transform definition alongside the SQL:

```
src/db/migrations/
├── 0067_add_recording_config.sql          (SQL migration)
├── 0067_add_recording_config.transform.ts (SnapshotTransform for this migration)
└── ...
```

The transform file exports a transform that knows how to handle the schema change:

```ts
// 0067_add_recording_config.transform.ts
import { SnapshotTransform } from '../services/snapshot/SnapshotSchemaMigrator';

export const transform: SnapshotTransform = {
  fromHash: 'hash_before_0067',
  toHash: 'hash_after_0067',
  migrationNumber: 67,

  upgrade(entityData) {
    const cloned = structuredClone(entityData);
    // New column 'recordingConfig' on projects — set default for old snapshots
    if (cloned.project && !cloned.project.recordingConfig) {
      cloned.project.recordingConfig = { enabled: false };
    }
    return cloned;
  },

  downgrade(entityData) {
    const cloned = structuredClone(entityData);
    // Remove recordingConfig when going backward
    if (cloned.project) {
      delete cloned.project.recordingConfig;
    }
    return cloned;
  },
};
```

### 6.5 Transform Types

Common transform patterns, mapped to typical schema changes:

| Schema Change | Transform Pattern | Example |
|---|---|---|
| **Add column** | Set default value on upgrade, delete on downgrade | New `recordingConfig` field |
| **Remove column** | Delete field on upgrade, set default on downgrade | Dropping deprecated field |
| **Rename column** | Copy value to new key, delete old key | `promptTrigger` → `triggerPhrase` |
| **Change column type** | Convert value format | `text[]` → `jsonb` array |
| **Add enum value** | No-op (backward compatible) — old values still valid | New `StageEnterBehavior` value |
| **Remove enum value** | Replace with nearest equivalent or default | Deprecated `apiType` removed |
| **Add entity type** | Add empty array on upgrade | New `quickPrompts: []` |
| **Remove entity type** | Delete array on upgrade | Entity table dropped |
| **Nested object restructure** | Deep-clone + restructure | `asrConfig.serverVad` shape change |

### 6.6 Migration Chain Execution

```
Snapshot (hash: v60) ──┐
                        │
                        ▼
            isCompatible(v60, current=v66)? → No
                        │
                        ▼
            Build chain: v60→v61→v62→v63→v64→v65→v66
                        │
                        ▼
            Apply transforms sequentially:
              entityData = transform60_61.upgrade(entityData)
              entityData = transform61_62.upgrade(entityData)
              ...         entityData = transform65_66.upgrade(entityData)
                        │
                        ▼
            Migrated data (hash: v66) ──→ restore / compare
```

**Chain building:** The migrator resolves the chain by walking registered transforms from `sourceHash` toward `currentHash`. If any link is missing (e.g., a migration was applied without its transform), the chain is broken and the operation fails with a clear error.

### 6.7 Restore with Schema Migration

The restore flow with schema awareness:

```
POST /api/projects/:id/snapshots/:snapshotId/restore
  │
  ├─ 1. Fetch snapshot, check schemaStatus
  │
  ├─ 2. If incompatible:
  │     ├─ Call migrator.migrateToCurrent(entityData, snapshotHash, currentHash)
  │     ├─ If chain broken → 400 "Snapshot v2 cannot be migrated to current schema"
  │     └─ Migrated entity_data replaces original for restore
  │
  ├─ 3. Validate provider UUIDs (existing logic)
  │
  ├─ 4. Pre-restore backup snapshot (captures current state)
  │
  ├─ 5. DB transaction: DELETE existing → INSERT migrated data
  │
  └─ 6. Return result with warnings
```

**Response when migration was applied:**
```json
{
  "restored": true,
  "snapshotVersion": 2,
  "schemaMigrated": true,
  "schemaMigrationSteps": 4,
  "entityCounts": { ... },
  "warnings": [
    {
      "type": "schema_migration_applied",
      "message": "Snapshot v2 was created before schema v63-66. Data was auto-migrated before restore. 4 transform steps applied."
    }
  ]
}
```

### 6.8 Compare with Schema Migration

Compare also requires schema migration when snapshots differ from current schema:

```
GET /api/projects/:id/snapshots/compare?fromVersion=2&toVersion=5
  │
  ├─ 1. Fetch both snapshots
  │
  ├─ 2. If either is incompatible:
  │     ├─ Migrate fromSnapshot to current schema
  │     ├─ Migrate toSnapshot to current schema
  │     └─ Compare migrated data (both now share same schema)
  │
  └─ 3. Run deep-diff algorithm on migrated data
```

**Why migrate both?** Without migration, a field rename would appear as "field removed + field added" instead of "field renamed". Migrating both snapshots to the current schema ensures the diff reflects actual user changes, not schema changes.

### 6.9 Startup Validation

At application startup (in `src/index.ts`, after DB migrations run but before server starts), the migrator validates the transform chain:

```ts
// src/index.ts (after existing migrations)
import { SnapshotSchemaMigrator } from './services/snapshot/SnapshotSchemaMigrator';

// ...existing startup code...

// Validate snapshot migration chain integrity
try {
  const migrator = container.resolve(SnapshotSchemaMigrator);
  const { currentHash } = versionService.getVersion();
  const chainStatus = migrator.validateChain(currentHash);
  if (!chainStatus.valid) {
    logger.warn(
      { missingMigrations: chainStatus.missing, gapCount: chainStatus.gapCount },
      'Snapshot migration chain has gaps — old snapshots cannot be restored or compared'
    );
  }
} catch (error) {
  logger.error({ error }, 'Snapshot migration chain validation failed');
  // Non-fatal: logs warning but does not abort startup
}
```

**Chain validation result:**
```json
{
  "valid": false,
  "currentHash": "abc123",
  "oldestHash": "def456",
  "gapCount": 2,
  "missing": [
    { "from": "hash_v58", "to": "hash_v59", "migrationNumber": 59 },
    { "from": "hash_v61", "to": "hash_v62", "migrationNumber": 62 }
  ]
}
```

When the chain is broken:
- **Create snapshot** — works normally (captures current schema)
- **List snapshots** — works, but `schemaStatus` shows `migrate_unavailable` for affected snapshots
- **Restore** — blocked with 400 error: "Snapshot v2 cannot be migrated: transform chain is broken at migration 59"
- **Compare** — blocked with same error

### 6.10 First-Release Considerations

**For the initial release (v1 of project snapshots):**

- No existing snapshots exist, so the chain starts clean.
- The first migration that adds the `project_snapshots` table does **not** need a transform (it's the baseline).
- All **subsequent** migrations that affect snapshot-captured entities must include a transform file.
- The `restSchemaHash` is captured at snapshot creation time and is the sole source of truth for compatibility.

**Migration checklist for future schema changes:**

1. Update `src/db/schema.ts` with the change
2. Update `src/http/contracts/` if API contracts change
3. Check if any snapshot-captured entity is affected
4. **If yes:** create `drizzle/00XX_migration_name.transform.ts` with upgrade/downgrade logic
5. Register transform in `SnapshotSchemaMigrator` at startup
6. Run `npm run db:generate` and `npm run db:migrate`
7. Verify chain: `npm run build` includes chain validation

### 6.11 Transform Testing

Transforms must be tested to ensure they round-trip correctly:

```ts
// tests/unit/snapshotTransform.test.ts
describe('0067_add_recording_config transform', () => {
  it('upgrade adds recordingConfig default when missing', () => {
    const oldData = { formatVersion: 1, restSchemaHash: 'hash_v66', project: { name: 'Test' }, agents: [] };
    const result = transform.upgrade(oldData);
    expect(result.project.recordingConfig).to.deep.equal({ enabled: false });
  });

  it('upgrade preserves existing recordingConfig', () => {
    const data = { formatVersion: 1, restSchemaHash: 'hash_v66', project: { name: 'Test', recordingConfig: { enabled: true } }, agents: [] };
    const result = transform.upgrade(data);
    expect(result.project.recordingConfig).to.deep.equal({ enabled: true });
  });

  it('downgrade removes recordingConfig', () => {
    const data = { formatVersion: 1, restSchemaHash: 'hash_v67', project: { name: 'Test', recordingConfig: { enabled: true } }, agents: [] };
    const result = transform.downgrade(data);
    expect(result.project.recordingConfig).to.be.undefined;
  });

  it('upgrade does not modify input object', () => {
    const oldData = { formatVersion: 1, restSchemaHash: 'hash_v66', project: { name: 'Test' }, agents: [] };
    transform.upgrade(oldData);
    expect(oldData.project.recordingConfig).to.be.undefined;
  });
});
```

## 7. Service Layer

### 7.1 `ProjectSnapshotService`

```ts
@injectable()
export class ProjectSnapshotService extends BaseService {
  constructor(
    @inject(SnapshotSchemaMigrator) private readonly migrator: SnapshotSchemaMigrator,
    @inject(VersionService) private readonly versionService: VersionService,
    @inject(AuditService) private readonly auditService: AuditService,
  ) { super(); }

  // Core operations
  async createSnapshot(projectId: string, input: SnapshotCreateInput, context: RequestContext): Promise<SnapshotResult>;
  async listSnapshots(projectId: string, params: ListParams, context: RequestContext): Promise<PaginatedSnapshots>;
  async getSnapshot(projectId: string, snapshotId: string, context: RequestContext): Promise<ProjectSnapshot>;
  async getSnapshotByVersion(projectId: string, version: number, context: RequestContext): Promise<ProjectSnapshot>;
  async updateSnapshotName(projectId: string, snapshotId: string, input: SnapshotUpdateInput, context: RequestContext): Promise<ProjectSnapshot>;
  async deleteSnapshot(projectId: string, snapshotId: string, context: RequestContext): Promise<void>;

  // Comparison
  async compareSnapshots(projectId: string, fromVersion: number, toVersion: number, context: RequestContext): Promise<SnapshotComparison>;

  // Restore
  async restoreSnapshot(projectId: string, snapshotId: string, context: RequestContext): Promise<RestoreResult>;

  // Internal
  private async captureEntityData(projectId: string): Promise<EntityData>;
  private async applyEntityData(entityData: EntityData, projectId: string): Promise<void>;
}
```

### 7.2 Capture Logic (`captureEntityData`)

The capture method mirrors `ProjectExchangeService.exportProject()` but:
1. **Preserves provider UUIDs** — no hint conversion needed (local-only).
2. **Includes runtime fields** — `version`, `createdAt`, `updatedAt` are captured as-is.
3. **Includes additional entity types** — sampleCopies, copyDecorators, testers, scenarios, quickPrompts.
4. **Embeds `restSchemaHash`** — captured from `VersionService.getVersion()` and stored in `entity_data.restSchemaHash`.

All entity fetches run in parallel (`Promise.all`) for performance.

### 7.3 Restore Logic (`applyEntityData`)

1. **Schema migration check**: Compare snapshot's `restSchemaHash` against current hash via `migrator.isCompatible()`.
2. **Apply migration transforms**: If incompatible, call `migrator.migrateToCurrent()` to transform entity_data. If chain is broken, return 400 error.
3. **Pre-restore backup**: Automatically creates a snapshot of current state before proceeding.
4. **Validate providers**: Check all provider UUIDs referenced in the (migrated) snapshot still exist.
5. **Delete existing entities**: TRUNCATE child tables in FK-safe reverse order within a transaction.
6. **Insert snapshot entities**: Insert in FK-safe order (same as `ProjectExchangeService.importProject()`).
7. **Update project row**: Apply project-level config from snapshot.
8. **Report warnings**: Any stale provider references are set to `null` and reported.

**Insert order:** project → agents → classifiers → contextTransformers → tools → globalActions → guardrails → knowledgeCategories → knowledgeItems → copyDecorators → sampleCopies → testers → scenarios → quickPrompts → stages

### 7.4 Comparison Logic (`compareSnapshots`)

The comparison algorithm:

1. Fetch both snapshots from the database.
2. **Schema migration**: If either snapshot's `restSchemaHash` differs from current, migrate both to current schema before comparing.
3. For each entity type, build a map by entity `id`.
3. Identify added (in `to` but not `from`), removed (in `from` but not `to`), and common entities.
4. For common entities, perform a deep field-by-field comparison:
   - Walk all properties recursively using dot-notation paths.
   - Skip `version`, `createdAt`, `updatedAt` fields.
   - Compare arrays and objects as whole values (deep equality).
   - Only report fields where values differ.
5. Group changes by entity type and entity ID.

**Deep comparison pseudo-code:**
```ts
function deepDiff(from: unknown, to: unknown, path = ''): FieldChange[] {
  if (from === to) return [];

  const currentPath = path || 'root';

  // Skip runtime metadata fields
  if (['version', 'createdAt', 'updatedAt'].includes(currentPath)) return [];

  // Both are plain objects — recurse
  if (isObject(from) && isObject(to)) {
    const allKeys = new Set([...Object.keys(from || {}), ...Object.keys(to || {})]);
    const changes: FieldChange[] = [];
    for (const key of allKeys) {
      const fieldPath = path ? `${path}.${key}` : key;
      changes.push(...deepDiff(
        (from as Record<string, unknown>)[key],
        (to as Record<string, unknown>)[key],
        fieldPath
      ));
    }
    return changes;
  }

  // Both are arrays — compare as whole values
  if (Array.isArray(from) && Array.isArray(to)) {
    if (!deepEqual(from, to)) {
      return [{ field: path, from, to }];
    }
    return [];
  }

  // Scalar or type mismatch
  return [{ field: path, from, to }];
}
```

## 8. Permissions

| Operation | Permission |
|---|---|
| Create snapshot | `PROJECT_WRITE` |
| List snapshots | `PROJECT_READ` |
| Get snapshot | `PROJECT_READ` |
| Compare snapshots | `PROJECT_READ` |
| Update snapshot name | `PROJECT_WRITE` |
| Restore from snapshot | `PROJECT_WRITE` |
| Delete snapshot | `PROJECT_WRITE` |

New permission entry in `src/permissions.ts`:
```ts
PROJECT_SNAPSHOT_READ: 'project_snapshot:read',
PROJECT_SNAPSHOT_WRITE: 'project_snapshot:write',
```

**Note:** Initially, `PROJECT_READ`/`PROJECT_WRITE` can be used directly (no new permissions needed). New dedicated permissions can be added later if fine-grained control is required. For v1, reuse existing project permissions.

## 9. Audit Logging

All snapshot operations log to `audit_logs`:

| Action | entityType | entityId | projectId |
|---|---|---|---|
| `SNAPSHOT_CREATE` | `project_snapshot` | snapshot ID | project ID |
| `SNAPSHOT_UPDATE` | `project_snapshot` | snapshot ID | project ID |
| `SNAPSHOT_DELETE` | `project_snapshot` | snapshot ID | project ID |
| `SNAPSHOT_RESTORE` | `project` | project ID | project ID |

The `SNAPSHOT_RESTORE` action logs the project-level change with `oldEntity`/`newEntity` showing the project config before/after restore.

## 10. Constraints and Limits

| Constraint | Value | Rationale |
|---|---|---|
| Max snapshots per project | 100 | Prevents unbounded storage growth. Configurable via env var `SNAPSHOT_MAX_PER_PROJECT`. |
| Snapshot name max length | 256 chars | Reasonable for human labels. |
| Auto-snapshot on restore | Always | Safety net — always create a backup before destructive operations. |
| Archived projects | Can read, cannot create/delete | Preserves historical record; prevents new snapshots of frozen projects. |
| Entity data size | No hard limit | JSONB can handle large payloads. Typical project snapshots: 50-500KB. |

## 11. Retention Policy (Future)

Not implemented in v1. Reserved for future:
- Configurable retention period (e.g., "keep last 90 days")
- Automatic cleanup of old snapshots
- Admin-only bulk deletion

## 12. WebSocket Events (Future)

Not implemented in v1. Reserved for future real-time notifications:
- `snapshot_created` — when a new snapshot is created
- `snapshot_restored` — when a project is restored from a snapshot

## 13. Implementation Plan

### Step 1: Database Migration
```ts
// src/db/schema.ts — add projectSnapshots table
// drizzle/00xx_xxx_project_snapshots.sql
```

### Step 2: Contract Schemas
```ts
// src/http/contracts/projectSnapshot.ts
// Zod schemas for request/response validation
```

### Step 3: Service Layer
```ts
// src/services/snapshot/SnapshotSchemaMigrator.ts
// Transform registry, chain builder, startup validation
// src/services/ProjectSnapshotService.ts
// Core business logic with migrator dependency
```

### Step 4: Controller
```ts
// src/http/controllers/ProjectSnapshotController.ts
// REST API endpoints
```

### Step 5: Server Registration
```ts
// src/server.ts
// container.resolve(ProjectSnapshotController).registerRoutes(app)
```

### Step 6: E2E Tests
```ts
// tests/e2e/projectSnapshot.test.ts
// Full test suite covering all endpoints
```

## 14. Open Questions

1. **Should snapshots be auto-created on entity changes?** — No for v1. Manual creation only. Auto-snapshots can be a background service added later.
2. **Should the comparison endpoint support comparing a snapshot against the live project?** — Deferred to v2. Would require capturing live state on-the-fly.
3. **Should snapshots include `users` table?** — No. Users are runtime data, not configuration.
4. **Should snapshots include `api_keys`?** — No. Credentials should never be versioned in snapshots.
5. **Should deleted snapshots be soft-deleted?** — No for v1. Hard delete. Soft delete can be added if needed.
6. **What happens when a project is deleted?** — Cascading delete via FK (`ON DELETE CASCADE`). All snapshots are removed with the project.

## 15. Entity Data Capture — Field Reference

For each captured entity, the following fields are included (matching the DB schema exactly):

### Project
`id`, `name`, `description`, `asrConfig`, `acceptVoice`, `generateVoice`, `storageConfig`, `moderationConfig`, `costManagementConfig`, `constants`, `metadata`, `timezone`, `languageCode`, `autoCreateUsers`, `userProfileVariableDescriptors`, `defaultGuardrailClassifierId`, `sampleCopyConfig`, `startingStageId`, `conversationTimeoutSeconds`, `recordingConfig`, `version`, `createdAt`, `updatedAt`

### Agent
`id`, `name`, `description`, `prompt`, `ttsProviderId`, `ttsSettings`, `tags`, `metadata`, `fillerSettings`, `version`, `createdAt`, `updatedAt`

### Stage
`id`, `name`, `description`, `prompt`, `llmProviderId`, `llmSettings`, `agentId`, `enterBehavior`, `useKnowledge`, `knowledgeTags`, `useGlobalActions`, `globalActions`, `variableDescriptors`, `actions`, `defaultClassifierId`, `transformerIds`, `tags`, `metadata`, `version`, `createdAt`, `updatedAt`

### Classifier
`id`, `name`, `description`, `prompt`, `llmProviderId`, `llmSettings`, `tags`, `metadata`, `version`, `createdAt`, `updatedAt`

### Context Transformer
`id`, `name`, `description`, `prompt`, `contextFields`, `llmProviderId`, `llmSettings`, `tags`, `metadata`, `version`, `createdAt`, `updatedAt`

### Tool
All fields including type-specific fields (`prompt`, `llmProviderId`, `url`, `webhookMethod`, `code`, etc.), `parameters`, `tags`, `metadata`, `version`, `createdAt`, `updatedAt`

### Global Action
All fields including `parameters`, `effects`, `examples`, `tags`, `metadata`, `version`, `createdAt`, `updatedAt`

### Guardrail
All fields including `effects`, `examples`, `tags`, `metadata`, `version`, `createdAt`, `updatedAt`

### Knowledge Category
`id`, `name`, `promptTrigger`, `tags`, `order`, `version`, `createdAt`, `updatedAt`

### Knowledge Item
`id`, `categoryId`, `questions`, `answer`, `order`, `version`, `createdAt`, `updatedAt`

### Sample Copy
All fields, `version`, `createdAt`, `updatedAt`

### Copy Decorator
`id`, `name`, `template`, `version`, `createdAt`, `updatedAt`

### Tester
All fields, `version`, `createdAt`, `updatedAt`

### Scenario
All fields, `version`, `createdAt`, `updatedAt`

### Quick Prompt
`id`, `projectId`, `categoryId`, `ownerId`, `name`, `description`, `content`, `tags`, `isPublic`, `isSystem`, `version`, `createdAt`, `updatedAt`
