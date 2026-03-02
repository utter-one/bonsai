# Configuration

Bonsai Backed is configured through environment variables. Copy the `.env.example` file to `.env` and adjust the values for your deployment.

## Environment Variables

### Server

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP server port |
| `CORS_ORIGIN` | `*` | Allowed CORS origin(s). Set to a specific domain in production |
| `NODE_ENV` | — | Set to `production` for production deployments |

### Database

| Variable | Default | Description |
|---|---|---|
| `DB_CONNECTION_STRING` | — | PostgreSQL connection string (e.g., `postgresql://user:pass@host:5432/db`) |
| `DB_POOL_SIZE` | `10` | Maximum number of database connections in the pool |
| `DB_SSL` | `false` | Set to `true` to enable SSL connections to the database |

### Authentication

| Variable | Default | Description |
|---|---|---|
| `JWT_SECRET` | — | **Required.** Secret key used to sign and verify JWT tokens |

### Logging

| Variable | Default | Description |
|---|---|---|
| `LOG_LEVEL` | `info` | Log level: `trace`, `debug`, `info`, `warn`, `error`, `fatal` |

### Build Info

| Variable | Default | Description |
|---|---|---|
| `GIT_COMMIT` | — | Git commit hash, exposed via the version endpoint |

## Docker Configuration

When running with Docker, configure environment variables in `docker-compose.yml` or pass them via `-e` flags:

```bash
docker run -d \
  -e DB_CONNECTION_STRING=postgresql://user:pass@db:5432/bonsai \
  -e JWT_SECRET=your-secret-key \
  -e PORT=3000 \
  -p 3000:3000 \
  bonsai-backend
```

Migrations run automatically on container startup before the application starts.

## Initial Setup

After starting the server for the first time, you need to create the initial super operator account. Use the setup endpoint:

```bash
curl -X POST http://localhost:3000/api/setup/initial-operator \
  -H "Content-Type: application/json" \
  -d '{
    "id": "operator",
    "name": "Super Operator",
    "password": "your-secure-password"
  }'
```

This endpoint is only available when no operator accounts exist. It creates a super operator with full system access.

## Swagger UI

API documentation is available at `/api-docs` once the server is running. It provides an interactive interface for exploring all REST API endpoints.

## WebSocket Endpoint

The WebSocket server listens at `/ws` on the same port as the HTTP server. Clients connect here for real-time conversational sessions.
