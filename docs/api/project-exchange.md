# Project Exchange

The project exchange API allows you to export a project as a self-contained, provider-agnostic bundle and import it into another environment. This is useful for migrating projects between environments, backing up configurations, or sharing templates.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/projects/:id/export` | Export a project as an exchange bundle |
| POST | `/api/projects/import` | Import a project from an exchange bundle |

## How It Works

### Export

When you export a project:
- All child entities (agents, stages, classifiers, context transformers, tools, global actions, guardrails, knowledge base) are included
- Provider UUID references are replaced by provider hints (`type` + `apiType`) so the bundle can be imported into any environment
- Credentials are never included
- Entity IDs are preserved as local cross-references

### Import

When you import a project:
- All entity IDs are remapped to fresh UUIDs, so repeated imports never overwrite existing data
- Provider hints are resolved to local provider IDs by matching `type` + `apiType` (first match wins)
- If no matching local provider is found, the corresponding provider field is set to `null`
- Returns the newly assigned project ID and a count of created entities

---

## Export Project

```
GET /api/projects/:id/export
```

**Required permission:** `project:read`

Produces a self-contained, provider-agnostic exchange bundle for the specified project.

### Response

The response is a `ProjectExchangeBundle` containing all project entities with provider hints instead of UUIDs.

**Errors:** `403` Insufficient permissions | `404` Project not found

---

## Import Project

```
POST /api/projects/import
Content-Type: application/json
```

**Required permission:** `project:write`

Imports a project from a provider-agnostic exchange bundle.

### Request Body

A `ProjectExchangeBundle` object (the same format returned by the export endpoint).

### Response

| Field | Type | Description |
|-------|------|-------------|
| `projectId` | `string` | ID of the newly created project |
| `entityCounts` | `Record<string, number>` | Count of created entities by type |

**Errors:** `400` Invalid exchange bundle | `403` Insufficient permissions
