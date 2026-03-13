# Audit Logs

Audit logs track all create, update, and delete operations performed on entities in the system.

**Tag:** `Audit Logs`

All audit log endpoints require the `audit:read` permission.

In addition, most entity types expose audit logs at their own path:

```
GET /api/operators/:id/audit-logs
GET /api/projects/:projectId/stages/:id/audit-logs
GET /api/projects/:projectId/agents/:id/audit-logs
GET /api/projects/:projectId/classifiers/:id/audit-logs
GET /api/projects/:projectId/context-transformers/:id/audit-logs
GET /api/projects/:projectId/tools/:id/audit-logs
GET /api/projects/:projectId/global-actions/:id/audit-logs
GET /api/projects/:projectId/conversations/:id/audit-logs
GET /api/issues/:id/audit-logs
GET /api/providers/:id/audit-logs
GET /api/environments/:id/audit-logs
GET /api/projects/:projectId/users/:id/audit-logs
```

## List Audit Logs

```http
GET /api/audit-logs
```

**Required permission:** `audit:read`

Supports [pagination & filtering](./pagination).

**Common Filters**

| Filter | Description |
|--------|-------------|
| `entityType` | Filter by entity type (e.g., `operator`, `agent`, `stage`) |
| `action` | Filter by action: `CREATE`, `UPDATE`, `DELETE` |
| `userId` | Filter by operator who performed the action |
| `entityId` | Filter by the affected entity's ID |
| `createdAt` | Filter by timestamp (supports operators: `gte`, `lte`, `between`) |

**Response** `200 OK`

```json
{
  "items": [
    {
      "id": "audit-123",
      "userId": "operator@example.com",
      "action": "UPDATE",
      "entityId": "agent-1",
      "entityType": "agent",
      "oldEntity": { "name": "Old Name" },
      "newEntity": { "name": "New Name" },
      "createdAt": "2025-01-15T10:00:00.000Z"
    }
  ],
  "total": 100,
  "offset": 0,
  "limit": 20
}
```

## Audit Log Response

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `id` | `string` | No | Unique audit log identifier |
| `userId` | `string` | Yes | Operator who performed the action |
| `action` | `string` | No | `CREATE`, `UPDATE`, or `DELETE` |
| `entityId` | `string` | No | ID of the affected entity |
| `entityType` | `string` | No | Type of entity (e.g., `operator`, `agent`, `stage`) |
| `oldEntity` | `object` | Yes | Entity state before the change (`null` for CREATE) |
| `newEntity` | `object` | Yes | Entity state after the change (`null` for DELETE) |
| `projectId` | `string` | Yes | Project ID the entity belongs to |
| `createdAt` | `string` | No | ISO 8601 timestamp |
