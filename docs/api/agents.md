# Agents

Agents define the AI character's voice and behavior in conversations. Each agent has a behavior prompt and TTS (text-to-speech) settings.

**Tag:** `Agents` | **Scoped to:** Project

For more information, see the [Agents](../guide/agents) guide.

## Create Agent

```http
POST /api/projects/:projectId/agents
Content-Type: application/json
```

**Required permission:** `agent:write`

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` (min 1) | No | Unique identifier (auto-generated if omitted) |
| `name` | `string` (min 1) | Yes | Display name |
| `description` | `string` | No | Description of agent purpose |
| `prompt` | `string` (min 1) | Yes | Agent characteristics and behavior prompt |
| `ttsProviderId` | `string` | No | TTS provider ID |
| `ttsSettings` | [`TtsSettings`](#tts-settings) | Yes | TTS provider-specific settings |
| `tags` | `string[]` | No | Tags for categorizing and filtering |
| `metadata` | `object` | No | Additional metadata |

**Response** `201 Created` — [Agent Response](#agent-response)

**Errors:** `400` Invalid body | `409` Agent already exists

## Get Agent

```http
GET /api/projects/:projectId/agents/:id
```

**Required permission:** `agent:read`

**Response** `200 OK` — [Agent Response](#agent-response)

## List Agents

```http
GET /api/projects/:projectId/agents
```

**Required permission:** `agent:read`

Supports [pagination & filtering](./pagination).

## Update Agent

```http
PUT /api/projects/:projectId/agents/:id
Content-Type: application/json
```

**Required permission:** `agent:write`

All create fields are optional plus `version` (required), **except `ttsSettings` which must always be provided**.

**Response** `200 OK` — [Agent Response](#agent-response)

**Errors:** `400` | `404` | `409`

## Delete Agent

```http
DELETE /api/projects/:projectId/agents/:id
Content-Type: application/json
```

**Required permission:** `agent:delete`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | `integer` (min 1) | Yes | Current version for optimistic locking |

**Response** `204 No Content`

## Clone Agent

```http
POST /api/projects/:projectId/agents/:id/clone
Content-Type: application/json
```

**Required permission:** `agent:write`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | No | New ID (auto-generated if omitted) |
| `name` | `string` | No | New name (defaults to "{original name} (Clone)") |

**Response** `201 Created` — [Agent Response](#agent-response)

## Get Audit Logs

```http
GET /api/projects/:projectId/agents/:id/audit-logs
```

**Required permission:** `audit:read`

Returns audit log entries for the specified agent. See [Audit Logs](./audit-logs) for response format.

---

## Agent Response

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `id` | `string` | No | Unique identifier |
| `projectId` | `string` | No | Parent project ID |
| `name` | `string` | No | Display name |
| `description` | `string` | Yes | Description |
| `prompt` | `string` | No | Behavior prompt |
| `ttsProviderId` | `string` | Yes | TTS provider ID |
| `ttsSettings` | `TtsSettings` | Yes | TTS settings |
| `tags` | `string[]` | No | Tags |
| `metadata` | `object` | Yes | Additional metadata |
| `version` | `integer` | No | Version number |
| `createdAt` | `string` | No | ISO 8601 creation timestamp |
| `updatedAt` | `string` | No | ISO 8601 last update timestamp |

## TTS Settings

TTS settings is a discriminated union based on the `provider` field:

### ElevenLabs
| Field | Type | Description |
|-------|------|-------------|
| `provider` | `"elevenlabs"` | Provider discriminator |
| `voiceId` | `string` | Voice identifier |
| `modelId` | `string` | Model identifier |
| `stability` | `number` | Voice stability (0-1) |
| `similarityBoost` | `number` | Similarity boost (0-1) |
| `style` | `number` | Voice style (0-1) |
| `outputFormat` | `string` | Audio output format |

### OpenAI
| Field | Type | Description |
|-------|------|-------------|
| `provider` | `"openai"` | Provider discriminator |
| `voice` | `string` | Voice name |
| `model` | `string` | Model name |
| `speed` | `number` | Speech speed |
| `responseFormat` | `string` | Output format |

### Deepgram
| Field | Type | Description |
|-------|------|-------------|
| `provider` | `"deepgram"` | Provider discriminator |
| `model` | `string` | Model name |
| `encoding` | `string` | Audio encoding |
| `sampleRate` | `number` | Sample rate |

### Cartesia
| Field | Type | Description |
|-------|------|-------------|
| `provider` | `"cartesia"` | Provider discriminator |
| `voiceId` | `string` | Voice identifier |
| `modelId` | `string` | Model identifier |
| `outputFormat` | `string` | Output format |

### Azure
| Field | Type | Description |
|-------|------|-------------|
| `provider` | `"azure"` | Provider discriminator |
| `voiceName` | `string` | Azure voice name |
| `outputFormat` | `string` | Output format |
| `style` | `string` | Voice style |
| `pitch` | `string` | Voice pitch |
| `rate` | `string` | Speech rate |
