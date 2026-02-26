# Projects

Projects are the top-level organizational unit. All conversation resources (stages, personas, classifiers, etc.) belong to a project.

**Tag:** `Projects`

For more information, see the [Projects](../guide/projects) guide and [Core Concepts](../guide/concepts).

## Create Project

```http
POST /api/projects
Content-Type: application/json
```

**Required permission:** `project:write`

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` (min 1, max 255) | Yes | Project name |
| `description` | `string` | No | Project description |
| `asrConfig` | [`AsrConfig`](#asr-config) | No | ASR configuration settings |
| `acceptVoice` | `boolean` | No (default: `true`) | Whether conversations accept voice input |
| `generateVoice` | `boolean` | No (default: `true`) | Whether conversations generate voice responses |
| `storageConfig` | [`StorageConfig`](#storage-config) | No | Storage configuration for conversation artifacts |
| `constants` | `Record<string, ParameterValue>` | No | Constants for templating and conversation logic |
| `metadata` | `object` | No | Additional metadata |

**Response** `201 Created` — [Project Response](#project-response)

**Errors:** `400` Invalid body | `409` Project already exists

## Get Project

```http
GET /api/projects/:id
```

**Required permission:** `project:read`

**Response** `200 OK` — [Project Response](#project-response)

**Errors:** `404` Not found

## List Projects

```http
GET /api/projects
```

**Required permission:** `project:read`

Supports [pagination & filtering](./pagination).

**Response** `200 OK`

```json
{
  "items": [ProjectResponse],
  "total": 5
}
```

## Update Project

```http
PUT /api/projects/:id
Content-Type: application/json
```

**Required permission:** `project:write`

All fields from the create body are optional. `version` is required for optimistic locking.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | `integer` | Yes | Current version for optimistic locking |
| `name` | `string` | No | Updated name |
| `description` | `string` | No | Updated description |
| `asrConfig` | [`AsrConfig`](#asr-config) | No | Updated ASR config |
| `acceptVoice` | `boolean` | No | Updated voice acceptance |
| `generateVoice` | `boolean` | No | Updated voice generation |
| `storageConfig` | [`StorageConfig`](#storage-config) | No | Updated storage config |
| `constants` | `Record<string, ParameterValue>` | No | Updated constants |
| `metadata` | `object` | No | Updated metadata |

**Response** `200 OK` — [Project Response](#project-response)

**Errors:** `400` Invalid body | `404` Not found | `409` Version conflict

## Delete Project

```http
DELETE /api/projects/:id
Content-Type: application/json
```

**Required permission:** `project:delete`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | `integer` | Yes | Current version for optimistic locking |

**Response** `204 No Content`

**Errors:** `400` Invalid body | `404` Not found | `409` Version conflict

---

## Project Response

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `id` | `string` | No | Unique identifier |
| `name` | `string` | No | Project name |
| `description` | `string` | Yes | Description |
| `asrConfig` | `AsrConfig` | Yes | ASR configuration |
| `acceptVoice` | `boolean` | No | Whether voice input is accepted |
| `generateVoice` | `boolean` | No | Whether voice is generated |
| `storageConfig` | `StorageConfig` | Yes | Storage configuration |
| `constants` | `Record<string, ParameterValue>` | Yes | Project constants |
| `metadata` | `object` | Yes | Additional metadata |
| `version` | `integer` | No | Version number |
| `createdAt` | `string` | No | ISO 8601 creation timestamp |
| `updatedAt` | `string` | No | ISO 8601 last update timestamp |

## ASR Config

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `asrProviderId` | `string` | No | ASR provider ID |
| `settings` | `object` | No | ASR-specific settings (varies by provider: Azure, ElevenLabs, Deepgram) |
| `unintelligiblePlaceholder` | `string` | No | Placeholder text for unintelligible speech |
| `voiceActivityDetection` | `boolean` | No | Enable voice activity detection |

## Storage Config

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `storageProviderId` | `string` | No | Storage provider ID |
| `settings` | `object` | No | Storage-specific settings (varies by provider: S3, Azure Blob, GCS, Local) |
