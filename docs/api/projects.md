# Projects

Projects are the top-level organizational unit. All conversation resources (stages, agents, classifiers, etc.) belong to a project.

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
| `moderationConfig` | [`ModerationConfig`](#moderation-config) | No | Content moderation configuration |
| `constants` | `Record<string, ParameterValue>` | No | Constants for templating and conversation logic |
| `metadata` | `object` | No | Additional metadata |
| `timezone` | `string` | No | IANA timezone identifier for conversations (e.g. `Europe/Warsaw`). Used as fallback when no per-user or per-conversation timezone is set. Defaults to UTC. |
| `languageCode` | `string` | No | ISO language code for conversations (e.g. `en-US`, `pl-PL`). Exposed in conversation context as `project.languageCode` and `project.language`. |
| `userProfileVariableDescriptors` | [`FieldDescriptor[]`](#field-descriptor) | No (default: `[]`) | Descriptors defining the data schema for user profile variables in this project |
| `conversationTimeoutSeconds` | `integer` (min: 0) | No | Inactivity timeout in seconds. Active conversations with no new events for this duration are automatically aborted. Set to `0` or omit to disable. Negative values are rejected. |
| `autoCreateUsers` | `boolean` | No (default: `false`) | When enabled, users are automatically created on first WebSocket connection if they do not exist |
| `defaultGuardrailClassifierId` | `string` | No | ID of the classifier used to evaluate guardrails for all conversations in this project |

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
| `moderationConfig` | [`ModerationConfig`](#moderation-config) | No | Updated moderation config |
| `constants` | `Record<string, ParameterValue>` | No | Updated constants |
| `metadata` | `object` | No | Updated metadata |
| `timezone` | `string` | No | Updated IANA timezone identifier |
| `languageCode` | `string` | No | Updated ISO language code |
| `userProfileVariableDescriptors` | [`FieldDescriptor[]`](#field-descriptor) | No | Updated descriptors for user profile variable schema |
| `conversationTimeoutSeconds` | `integer` (min: 0) or `null` | No | Updated inactivity timeout in seconds. Set to `0` or `null` to disable. |
| `autoCreateUsers` | `boolean` | No | Updated auto-create users setting |
| `defaultGuardrailClassifierId` | `string` or `null` | No | Updated guardrail classifier ID. Set to `null` to disable. |

**Response** `200 OK` — [Project Response](#project-response)

**Errors:** `400` Invalid body | `404` Not found | `409` Version conflict

## Delete Project

```http
DELETE /api/projects/:id
```

**Required permission:** `project:delete`

**Response** `204 No Content`

**Errors:** `404` Not found

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
| `moderationConfig` | `ModerationConfig` | Yes | Content moderation configuration |
| `constants` | `Record<string, ParameterValue>` | Yes | Project constants |
| `metadata` | `object` | Yes | Additional metadata |
| `timezone` | `string` | Yes | IANA timezone identifier (null means UTC) |
| `languageCode` | `string` | Yes | ISO language code (e.g. `en-US`, `pl-PL`), or `null` if not set |
| `userProfileVariableDescriptors` | [`FieldDescriptor[]`](#field-descriptor) | No | Descriptors defining the data schema for user profile variables |
| `conversationTimeoutSeconds` | `integer` | Yes | Inactivity timeout in seconds. `null` or `0` means no timeout. |
| `autoCreateUsers` | `boolean` | No | Whether users are auto-created on first WebSocket connection |
| `defaultGuardrailClassifierId` | `string` | Yes | Classifier ID for evaluating guardrails |
| `version` | `integer` | No | Version number |
| `createdAt` | `string` | No | ISO 8601 creation timestamp |
| `updatedAt` | `string` | No | ISO 8601 last update timestamp |
| `archivedAt` | `string` | Yes | ISO 8601 timestamp when the project was archived |
| `archivedBy` | `string` | Yes | ID of the operator who archived the project |

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

## Field Descriptor

Describes a single field in a typed schema. Used in `userProfileVariableDescriptors` to define the expected shape of a user's profile data, enabling validation and tooling.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Field name |
| `type` | `string` | Yes | One of: `string`, `number`, `boolean`, `object`, `string[]`, `number[]`, `boolean[]`, `object[]`, `image`, `image[]`, `audio`, `audio[]` |
| `isArray` | `boolean` | Yes | Whether the field holds an array of values |
| `objectSchema` | `FieldDescriptor[]` | No | Nested field descriptors when `type` is `object` or `object[]` |

## Moderation Config

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `enabled` | `boolean` | Yes | Whether content moderation is enabled for this project |
| `llmProviderId` | `string` | Yes | ID of the LLM provider used for moderation (must support moderation API, e.g. OpenAI or Mistral) |
| `blockedCategories` | `string[]` | No | List of category names that should cause the input to be blocked. If omitted or empty, any flagged category will block the input. Category names are provider-specific. |

## Archive Project

```http
POST /api/projects/:id/archive
Content-Type: application/json
```

**Required permission:** `project:write`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | `integer` | Yes | Current version for optimistic locking |

**Response** `200 OK` — [Project Response](#project-response)

**Errors:** `404` Not found | `409` Version conflict or already archived

## Unarchive Project

```http
POST /api/projects/:id/unarchive
Content-Type: application/json
```

**Required permission:** `project:write`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | `integer` | Yes | Current version for optimistic locking |

**Response** `200 OK` — [Project Response](#project-response)

**Errors:** `400` Project is not archived | `404` Not found | `409` Version conflict
