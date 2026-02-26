# Stages

Stages define the conversational flow within a project. Each stage has its own prompt, LLM settings, actions, and associated persona.

**Tag:** `Stages` | **Scoped to:** Project

## Create Stage

```http
POST /api/projects/:projectId/stages
Content-Type: application/json
```

**Required permission:** `stage:write`

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` (min 1) | No | Unique identifier (auto-generated if omitted) |
| `name` | `string` (min 1) | Yes | Display name |
| `description` | `string` | No | Detailed description |
| `prompt` | `string` (min 1) | Yes | System prompt defining stage behavior |
| `llmProviderId` | `string` | No | LLM provider ID |
| `llmSettings` | [`LlmSettings`](#llm-settings) | Yes | LLM provider-specific settings |
| `personaId` | `string` (min 1) | Yes | Associated persona ID |
| `enterBehavior` | `string` | No | `"generate_response"` (default) or `"await_user_input"` |
| `useKnowledge` | `boolean` | No (default: `false`) | Enable knowledge base for this stage |
| `knowledgeTags` | `string[]` | No | Knowledge tags to include |
| `useGlobalActions` | `boolean` | No (default: `true`) | Enable global actions |
| `globalActions` | `string[]` | No | Specific global action IDs to enable |
| `variableDescriptors` | [`FieldDescriptor[]`](#field-descriptor) | No | Variable descriptor definitions |
| `actions` | `Record<string, StageAction>` | No | Action definitions map (see [Actions](#actions)) |
| `defaultClassifierId` | `string` | No | Default classifier ID |
| `transformerIds` | `string[]` | No | Context transformer IDs |
| `metadata` | `object` | No | Additional metadata |

**Response** `201 Created` — [Stage Response](#stage-response)

**Errors:** `400` Invalid body | `409` Stage already exists

## Get Stage

```http
GET /api/projects/:projectId/stages/:id
```

**Required permission:** `stage:read`

**Response** `200 OK` — [Stage Response](#stage-response)

**Errors:** `404` Not found

## List Stages

```http
GET /api/projects/:projectId/stages
```

**Required permission:** `stage:read`

Supports [pagination & filtering](./pagination).

**Response** `200 OK` — Paginated list of [Stage Response](#stage-response)

## Update Stage

```http
PUT /api/projects/:projectId/stages/:id
Content-Type: application/json
```

**Required permission:** `stage:write`

All create fields are optional plus `version` (required for optimistic locking).

**Response** `200 OK` — [Stage Response](#stage-response)

**Errors:** `400` Invalid body | `404` Not found | `409` Version conflict

## Delete Stage

```http
DELETE /api/projects/:projectId/stages/:id
Content-Type: application/json
```

**Required permission:** `stage:delete`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | `integer` (min 1) | Yes | Current version for optimistic locking |

**Response** `204 No Content`

## Clone Stage

```http
POST /api/projects/:projectId/stages/:id/clone
Content-Type: application/json
```

**Required permission:** `stage:write`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` (min 1) | No | New ID (auto-generated if omitted) |
| `name` | `string` (min 1) | No | New name (defaults to "{original name} (Clone)") |

**Response** `201 Created` — [Stage Response](#stage-response)

## Get Audit Logs

```http
GET /api/projects/:projectId/stages/:id/audit-logs
```

**Required permission:** `audit:read`

Returns audit log entries for the specified stage. See [Audit Logs](./audit-logs) for response format.

---

## Stage Response

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `id` | `string` | No | Unique identifier |
| `projectId` | `string` | No | Parent project ID |
| `name` | `string` | No | Display name |
| `description` | `string` | Yes | Description |
| `prompt` | `string` | No | System prompt |
| `llmProviderId` | `string` | Yes | LLM provider ID |
| `llmSettings` | `LlmSettings` | No | LLM settings |
| `personaId` | `string` | No | Associated persona ID |
| `enterBehavior` | `string` | No | `"generate_response"` or `"await_user_input"` |
| `useKnowledge` | `boolean` | No | Knowledge base enabled |
| `knowledgeTags` | `string[]` | No | Knowledge tags |
| `useGlobalActions` | `boolean` | No | Global actions enabled |
| `globalActions` | `string[]` | No | Global action IDs |
| `variableDescriptors` | `FieldDescriptor[]` | No | Variable definitions |
| `actions` | `Record<string, StageAction>` | No | Action definitions |
| `defaultClassifierId` | `string` | Yes | Default classifier ID |
| `transformerIds` | `string[]` | No | Transformer IDs |
| `metadata` | `object` | Yes | Additional metadata |
| `version` | `integer` | No | Version number |
| `createdAt` | `string` | No | ISO 8601 creation timestamp |
| `updatedAt` | `string` | No | ISO 8601 last update timestamp |

## Actions

Actions are defined as a `Record<string, StageAction>` where keys are action names.

### Reserved Lifecycle Actions

| Key | Description |
|-----|-------------|
| `__on_enter` | Executed when entering the stage |
| `__on_leave` | Executed when leaving the stage |
| `__on_fallback` | Executed when no user action matches |

### StageAction

| Field | Type | Description |
|-------|------|-------------|
| `condition` | `string?` | Condition expression for activation |
| `classificationTrigger` | `string?` | Classification label that triggers this action |
| `overrideClassifierId` | `string?` | Classifier ID override |
| `parameters` | `StageActionParameter[]` | Parameters to extract from user input |
| `effects` | `Effect[]` | Effects to execute when triggered |
| `examples` | `string[]` | Example trigger phrases |

### StageActionParameter

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Parameter name |
| `type` | `string` | Parameter type |
| `description` | `string` | Parameter description |
| `required` | `boolean` | Whether the parameter is required |

### Effect

Effects define what happens when an action is triggered (e.g., jump to stage, set variable, call webhook, run tool).

## LLM Settings

LLM settings is a discriminated union based on provider type:

- **OpenAI** — `model`, `temperature`, `maxTokens`, `topP`, `frequencyPenalty`, `presencePenalty`
- **OpenAI Legacy** — Same as OpenAI with legacy API format
- **Anthropic** — `model`, `temperature`, `maxTokens`, `topP`, `topK`
- **Gemini** — `model`, `temperature`, `maxOutputTokens`, `topP`, `topK`

## Field Descriptor

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Variable name |
| `type` | `string` | Variable type |
| `description` | `string` | Human-readable description |
| `required` | `boolean` | Whether the variable is required |
