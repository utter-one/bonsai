# Version

Returns API schema version hashes for compatibility checking.

**Tag:** `System` | **Authentication:** None required

## Get Version

```http
GET /version
```

::: info
Note that this endpoint is at `/version`, not `/api/version`.
:::

**Response** `200 OK`

```json
{
  "restSchemaHash": "a1b2c3d4e5f6",
  "wsSchemaHash": "f6e5d4c3b2a1",
  "gitCommit": "abc1234"
}
```

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `restSchemaHash` | `string` | No | First 12 hex chars of SHA-256 of the REST OpenAPI schema |
| `wsSchemaHash` | `string` | No | First 12 hex chars of SHA-256 of the WebSocket contracts schema |
| `gitCommit` | `string` | Yes | Short git commit SHA (from `GIT_COMMIT` env var, `null` if not set) |
