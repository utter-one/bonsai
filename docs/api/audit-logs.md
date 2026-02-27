# Audit Logs

Audit logs track all create, update, and delete operations performed on entities in the system.

**Tag:** `Audit Logs`

All audit log endpoints require the `audit:read` permission.

In addition, most entity types expose audit logs at their own path:

```
GET /api/admins/:id/audit-logs
GET /api/projects/:projectId/stages/:id/audit-logs
GET /api/projects/:projectId/personas/:id/audit-logs
GET /api/projects/:projectId/classifiers/:id/audit-logs
GET /api/projects/:projectId/context-transformers/:id/audit-logs
GET /api/projects/:projectId/tools/:id/audit-logs
GET /api/projects/:projectId/global-actions/:id/audit-logs
GET /api/projects/:projectId/conversations/:id/audit-logs
GET /api/projects/:projectId/issues/:id/audit-logs
GET /api/providers/:id/audit-logs
GET /api/environments/:id/audit-logs
GET /api/users/:id/audit-logs
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
| `entityType` | Filter by entity type (e.g., `admin`, `persona`, `stage`) |
| `action` | Filter by action: `CREATE`, `UPDATE`, `DELETE` |
| `userId` | Filter by admin who performed the action |
| `entityId` | Filter by the affected entity's ID |
| `createdAt` | Filter by timestamp (supports operators: `gte`, `lte`, `between`) |

**Response** `200 OK`

```json
{
  "items": [
    {
      "id": "audit-123",
      "userId": "admin@example.com",
      "action": "UPDATE",
      "entityId": "persona-1",
      "entityType": "persona",
      "oldEntity": { "name": "Old Name" },
      "newEntity": { "name": "New Name" },
      "version": 1,
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
| `userId` | `string` | Yes | Admin who performed the action |
| `action` | `string` | No | `CREATE`, `UPDATE`, or `DELETE` |
| `entityId` | `string` | No | ID of the affected entity |
| `entityType` | `string` | No | Type of entity (e.g., `admin`, `persona`, `stage`) |
| `oldEntity` | `object` | Yes | Entity state before the change (`null` for CREATE) |
| `newEntity` | `object` | Yes | Entity state after the change (`null` for DELETE) |
| `version` | `integer` | No | Audit log version |
| `createdAt` | `string` | No | ISO 8601 timestamp |
