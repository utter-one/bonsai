# Providers

Providers configure external service integrations for LLM, TTS, ASR, and storage backends.

**Tag:** `Providers`

For more information, see the [Providers](../guide/providers) guide.

## Create Provider

```http
POST /api/providers
Content-Type: application/json
```

**Required permission:** `provider:write`

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` (min 1) | No | Unique identifier (auto-generated if omitted) |
| `name` | `string` (min 1) | Yes | Human-readable name |
| `description` | `string` | No | Detailed description |
| `providerType` | `string` | Yes | `asr`, `tts`, `llm`, `embeddings`, or `storage` |
| `apiType` | `string` | Yes | Specific provider implementation (see below) |
| `config` | `object` | Yes | Provider-specific configuration (see [Provider Config](#provider-config)) |
| `createdBy` | `string` | No | Admin user ID who created |
| `tags` | `string[]` | No | Searchable tags |

**Response** `201 Created` — [Provider Response](#provider-response)

**Errors:** `400` Invalid body | `409` Already exists

## Get Provider

```http
GET /api/providers/:id
```

**Required permission:** `provider:read`

**Response** `200 OK` — [Provider Response](#provider-response)

## List Providers

```http
GET /api/providers
```

**Required permission:** `provider:read`

Supports [pagination & filtering](./pagination).

## Update Provider

```http
PUT /api/providers/:id
Content-Type: application/json
```

**Required permission:** `provider:write`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | `integer` (positive) | Yes | Current version for optimistic locking |
| `name` | `string` (min 1) | No | Updated name |
| `description` | `string` | No | Updated description |
| `providerType` | `string` | No | Updated provider type |
| `apiType` | `string` | No | Updated API type |
| `config` | `object` | No | Updated configuration |
| `tags` | `string[]` | No | Updated tags |

**Response** `200 OK` — [Provider Response](#provider-response)

**Errors:** `400` | `404` | `409`

## Delete Provider

```http
DELETE /api/providers/:id
Content-Type: application/json
```

**Required permission:** `provider:delete`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | `integer` (positive) | Yes | Current version for optimistic locking |

**Response** `204 No Content`

## Get Audit Logs

```http
GET /api/providers/:id/audit-logs
```

**Required permission:** `audit:read`

Returns audit log entries for the specified provider. See [Audit Logs](./audit-logs) for response format.

---

## Provider Response

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `id` | `string` | No | Unique identifier |
| `name` | `string` | No | Human-readable name |
| `description` | `string` | Yes | Description |
| `providerType` | `string` | No | `asr`, `tts`, `llm`, `embeddings`, or `storage` |
| `apiType` | `string` | No | Provider implementation type |
| `config` | `object` | No | Provider configuration |
| `createdBy` | `string` | Yes | Creator's admin ID |
| `tags` | `string[]` | Yes | Tags |
| `version` | `integer` | No | Version number |
| `createdAt` | `string` | No | ISO 8601 creation timestamp |
| `updatedAt` | `string` | No | ISO 8601 last update timestamp |

## Provider Config

Configuration varies by provider type and API type:

### LLM Providers

| API Type | Key Config Fields |
|----------|------------------|
| `openai` | `apiKey`, `baseUrl`, `organization` |
| `openai-legacy` | `apiKey`, `baseUrl`, `organization` |
| `anthropic` | `apiKey`, `baseUrl` |
| `gemini` | `apiKey`, `baseUrl` |

### TTS Providers

| API Type | Key Config Fields |
|----------|------------------|
| `elevenlabs` | `apiKey` |
| `openai` | `apiKey` |
| `deepgram` | `apiKey` |
| `cartesia` | `apiKey` |
| `azure` | `subscriptionKey`, `region` |

### ASR Providers

| API Type | Key Config Fields |
|----------|------------------|
| `azure` | `subscriptionKey`, `region`, `language` |
| `elevenlabs` | `apiKey` |
| `deepgram` | `apiKey` |
| `assemblyai` | `apiKey`, `region` |
| `speechmatics` | `apiKey`, `region` |

### Storage Providers

| API Type | Key Config Fields |
|----------|------------------|
| `s3` | `bucket`, `region`, `accessKeyId`, `secretAccessKey` |
| `azure-blob` | `connectionString`, `containerName` |
| `gcs` | `bucket`, `projectId`, `credentials` |
| `local` | `basePath` |
