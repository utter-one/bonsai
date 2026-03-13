# Audit Logs

**Audit Logs** provide a complete, immutable record of all write operations performed on entities in the system. Every create, update, and delete action is automatically logged with full before/after snapshots.

## What Gets Logged

All entity mutations are recorded, including:

- Creating, updating, and deleting projects, stages, agents, classifiers, context transformers, tools, global actions, guardrails, knowledge categories/items, providers, environments, API keys, users, issues, and operators
- Archiving and unarchiving entities

Each audit log entry captures:

| Field | Description |
|---|---|
| `id` | Auto-incrementing identifier |
| `projectId` | Associated project ID (if the entity is project-scoped) |
| `entityType` | Type of entity affected (e.g., `project`, `stage`, `agent`) |
| `entityId` | ID of the affected entity |
| `action` | Operation performed: `create`, `update`, `delete` |
| `operatorId` | ID of the operator who performed the action |
| `oldEntity` | Snapshot of the entity **before** the operation (null for creates) |
| `newEntity` | Snapshot of the entity **after** the operation (null for deletes) |
| `createdAt` | Timestamp of the operation |

## Accessing Audit Logs

Audit logs can be accessed in two ways:

### Global Audit Logs

Retrieve audit logs across the entire system, with filtering by entity type or other criteria:

```
GET /api/audit-logs
```

### Entity-Specific Audit Logs

Retrieve the audit history for a specific entity:

```
GET /api/projects/:projectId/stages/:id/audit-logs
GET /api/projects/:projectId/agents/:id/audit-logs
GET /api/issues/:id/audit-logs
```

Most entities expose an `/audit-logs` sub-endpoint that returns only the logs for that specific entity.

## Use Cases

- **Change tracking** — See who changed what and when across the entire system
- **Debugging** — Compare before/after snapshots to understand how a configuration change affected behavior
- **Compliance** — Maintain a full audit trail for regulatory requirements
- **Rollback reference** — Use `oldEntity` snapshots to manually restore previous configurations

## Security

Audit logs require the `audit:read` permission. They are **read-only** — audit entries cannot be modified or deleted through the API.

::: tip
The `oldEntity` and `newEntity` fields contain full entity snapshots, which makes audit logs useful for understanding the complete state change — not just which fields were modified.
:::

See the [Audit Logs API reference](/api/audit-logs) for full endpoint details.
