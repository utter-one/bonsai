# Personas

Personas define the AI character's voice and behavior in conversations. Each persona has a behavior prompt and TTS (text-to-speech) settings.

**Tag:** `Personas` | **Scoped to:** Project

## Create Persona

```http
POST /api/projects/:projectId/personas
Content-Type: application/json
```

**Required permission:** `persona:write`

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` (min 1) | No | Unique identifier (auto-generated if omitted) |
| `name` | `string` (min 1) | Yes | Display name |
| `description` | `string` | No | Description of persona purpose |
| `prompt` | `string` (min 1) | Yes | Persona characteristics and behavior prompt |
| `ttsProviderId` | `string` | No | TTS provider ID |
| `ttsSettings` | [`TtsSettings`](#tts-settings) | Yes | TTS provider-specific settings |
| `metadata` | `object` | No | Additional metadata |

**Response** `201 Created` — [Persona Response](#persona-response)

**Errors:** `400` Invalid body | `409` Persona already exists

## Get Persona

```http
GET /api/projects/:projectId/personas/:id
```

**Required permission:** `persona:read`

**Response** `200 OK` — [Persona Response](#persona-response)

## List Personas

```http
GET /api/projects/:projectId/personas
```

**Required permission:** `persona:read`

Supports [pagination & filtering](./pagination).

## Update Persona

```http
PUT /api/projects/:projectId/personas/:id
Content-Type: application/json
```

**Required permission:** `persona:write`

All create fields are optional plus `version` (required).

**Response** `200 OK` — [Persona Response](#persona-response)

**Errors:** `400` | `404` | `409`

## Delete Persona

```http
DELETE /api/projects/:projectId/personas/:id
Content-Type: application/json
```

**Required permission:** `persona:delete`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | `integer` (min 1) | Yes | Current version for optimistic locking |

**Response** `204 No Content`

## Clone Persona

```http
POST /api/projects/:projectId/personas/:id/clone
Content-Type: application/json
```

**Required permission:** `persona:write`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | No | New ID (auto-generated if omitted) |
| `name` | `string` | No | New name (defaults to "{original name} (Clone)") |

**Response** `201 Created` — [Persona Response](#persona-response)

## Get Audit Logs

```http
GET /api/projects/:projectId/personas/:id/audit-logs
```

**Required permission:** `audit:read`

Returns audit log entries for the specified persona. See [Audit Logs](./audit-logs) for response format.

---

## Persona Response

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `id` | `string` | No | Unique identifier |
| `projectId` | `string` | No | Parent project ID |
| `name` | `string` | No | Display name |
| `description` | `string` | Yes | Description |
| `prompt` | `string` | No | Behavior prompt |
| `ttsProviderId` | `string` | Yes | TTS provider ID |
| `ttsSettings` | `TtsSettings` | Yes | TTS settings |
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
