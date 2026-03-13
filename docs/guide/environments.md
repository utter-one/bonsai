# Environments

**Environments** represent remote Bonsai Backend server instances used for data migration. They store connection credentials to another Bonsai instance so you can preview and pull configuration (projects, stages, agents, providers, etc.) from that remote instance into the current one.

Environments are **not project-scoped** — they are global entities managed by operators with `environment:write` permission.

## Structure

| Field | Description |
|---|---|
| `id` | Unique identifier (auto-generated with `env_` prefix if not provided) |
| `description` | Human-readable description of the environment |
| `url` | Base URL of the remote Bonsai Backend instance |
| `login` | Authentication username for the remote instance |
| `password` | Authentication password (write-only, never returned in API responses) |
| `version` | Optimistic locking version |

::: warning
The `password` field is stored in the database but **never returned in API responses** for security. It is also stripped from audit log records.
:::

## Use Cases

Environments enable multi-instance workflows:

- **Staging → Production** — Design and test conversation flows on a staging instance, then pull the finalized configuration into production
- **Multi-instance sync** — Keep multiple Bonsai deployments in sync by pulling shared configurations
- **Backup and restore** — Pull configuration from a remote instance as a form of backup

## Migration Workflow

Environments are used with the [Migration](/api/migration) endpoints:

1. **Create an environment** with the remote instance's URL and credentials
2. **Preview** — `POST /api/migration/remote/preview` to see what entities are available on the remote instance
3. **Pull** — `POST /api/migration/remote/pull` to start an asynchronous import of selected entities

During a pull, the system authenticates against the remote instance using the stored credentials, fetches the selected entities, and imports them into the current instance.

## Common Operations

- **Create** — `POST /api/environments`
- **List** — `GET /api/environments` (with pagination, search, and filtering)
- **Get** — `GET /api/environments/:id`
- **Update** — `PUT /api/environments/:id` (requires `version`)
- **Delete** — `DELETE /api/environments/:id` (requires `version`)

See the [Environments API reference](/api/environments) for full details.
