# Configuration

Bonsai Backend is configured through environment variables. Copy the `.env.example` file to `.env` and adjust the values for your deployment.

## Environment Variables

### Server

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP server port |
| `CORS_ORIGIN` | `*` | Allowed CORS origin(s). Set to a specific domain in production |
| `NODE_ENV` | — | Set to `production` for production deployments |
| `TRUST_PROXY` | `true` | Set to `false` to disable trust proxy |
| `WS_MAX_PAYLOAD_BYTES` | `10485760` | Maximum WebSocket message payload size in bytes (default: 10 MB) |

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

### Secrets Management

| Variable | Default | Description |
|---|---|---|
| `MASTER_ENCRYPTION_KEY` | — | **Required.** 32-byte AES master key (64-char hex or 44-char base64) used to encrypt provider API keys and other credentials stored in the database. Generate with: `openssl rand -hex 32`. See [Secrets Management](/guide/secrets). |

### Logging

| Variable | Default | Description |
|---|---|---|
| `LOG_LEVEL` | `info` | Log level: `trace`, `debug`, `info`, `warn`, `error`, `fatal` |

### Build Info

| Variable | Default | Description |
|---|---|---|
| `GIT_COMMIT` | — | Git commit hash, exposed via the version endpoint |
| `SOURCE_COMMIT` | — | Alternative git commit hash (used when `GIT_COMMIT` is not set) |

### Rate Limiting

| Variable | Default | Description |
|---|---|---|
| `RATE_LIMIT_AUTH_WINDOW_MS` | `900000` | Time window for auth rate limiting in milliseconds (default: 15 min) |
| `RATE_LIMIT_AUTH_MAX` | `10` | Max auth attempts per window per IP |
| `RATE_LIMIT_WS_AUTH_WINDOW_MS` | `900000` | Time window for WebSocket auth rate limiting (default: 15 min) |
| `RATE_LIMIT_WS_AUTH_MAX` | `10` | Max WebSocket auth attempts per window per IP |
| `RATE_LIMIT_API_WINDOW_MS` | `60000` | Time window for API rate limiting (default: 1 min) |
| `RATE_LIMIT_API_MAX` | `300` | Max API requests per window per operator (or IP if unauthenticated) |

### WebRTC

| Variable | Default | Description |
|---|---|---|
| `WEBRTC_ICE_GATHERING_TIMEOUT_MS` | `5000` | Max milliseconds to wait for ICE candidate gathering |
| `WEBRTC_STUN_URL` | `stun:stun.l.google.com:19302` | STUN server URL for ICE gathering |

### Testing

| Variable | Default | Description |
|---|---|---|
| `TESTING_SCHEDULER_ENABLED` | `true` | Set to `false` to disable the scenario run scheduler |
| `TESTING_MAX_PARALLEL_CONVERSATIONS` | `5` | Maximum number of parallel scenario run conversations |

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
