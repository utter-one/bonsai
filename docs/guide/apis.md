# APIs

Bonsai Backend exposes two API surfaces, each serving a different purpose and audience. Plus dedicated endpoints exposing schemas for these two.

## REST API

The REST API is used for **administration**: creating and managing projects, stages, agents, providers, and all other entities. It is protected by JWT authentication with role-based permissions.

- **Base path:** `/api/`
- **Authentication:** JWT bearer token or operator session
- **Audience:** Operators and content managers
- **Documentation:** Interactive Swagger UI available at `/api-docs`

See the [Authentication](./authentication) guide for details on obtaining tokens and managing permissions.

## Rate Limiting

The API enforces two tiers of rate limiting:

### Authentication Endpoints

`POST /api/auth/login` and `POST /api/auth/refresh` are protected by a **per-IP** rate limiter to prevent brute-force attacks.

- **Default limit:** 10 requests per 15 minutes per IP address
- **Configurable via:** `RATE_LIMIT_AUTH_WINDOW_MS` and `RATE_LIMIT_AUTH_MAX`

### General API

All other API endpoints are protected by a **per-operator** rate limiter. For unauthenticated requests the IP address is used as the key.

- **Default limit:** 300 requests per minute per operator
- **Configurable via:** `RATE_LIMIT_API_WINDOW_MS` and `RATE_LIMIT_API_MAX`

### Rate Limit Response

When a limit is exceeded the server returns `429 Too Many Requests` with a `Retry-After` header (in seconds) and a JSON error body:

```json
{
  "error": "Too many requests, please slow down"
}
```

## WebSocket API

The WebSocket API is used for **live conversations**: real-time bidirectional communication for voice and text sessions. It is protected by project-scoped API keys.

- **Endpoint:** `/ws`
- **Authentication:** Project API key (sent in the `auth` message after connecting)
- **Audience:** Client applications (web apps, mobile apps, kiosks, etc.)

See the [WebSocket Protocol](./websocket) guide for the full message protocol reference.

## Schema Endpoints

The backend exposes two unauthenticated endpoints that serve machine-readable schema definitions. These are useful for generating typed clients, validating messages, and building tooling.

### OpenAPI Spec

```
GET /openapi.json
```

Returns the full OpenAPI 3.0 specification for the REST API as JSON. This is the same spec that powers the Swagger UI at `/api-docs`. Use it to generate REST client SDKs or import into API tools such as Postman or Insomnia.

### WebSocket Contracts Schema

```
GET /websocket-contracts.json
```

Returns a JSON Schema document describing all WebSocket message types (both client→server and server→client). The schema is generated automatically from the Zod contract definitions in `src/websocket/contracts/` and is regenerated on every build (`npm run schemas:generate`).

Use this schema to:
- Validate outgoing and incoming WebSocket messages in client code
- Generate typed message interfaces for TypeScript or other languages
- Document the real-time protocol for external integrators
