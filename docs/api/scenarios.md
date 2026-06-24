# Scenarios

Scenarios define the parameters of an automated conversation test: which stage to start from, how many turns are allowed, when the conversation ends, what data to extract, and optional post-processing expectations. They are created by operators and executed by the system through [Scenario Runs](./scenario-runs).

**Tag:** `Scenarios` | **Scoped to:** Project

## Create Scenario

```http
POST /api/projects/:projectId/scenarios
Content-Type: application/json
```

**Required permission:** `scenario:write`

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` (min 1) | No | Unique identifier (auto-generated if omitted) |
| `name` | `string` (min 1) | Yes | Display name |
| `description` | `string` | No | Detailed description (nullable) |
| `language` | `string` (min 1) | Yes | Language code for the conversation (e.g. `en`) |
| `startingStageId` | `string` (min 1) | Yes | Stage ID where the conversation begins |
| `maxTurns` | `integer` (min 1) | Yes | Maximum number of conversation turns before the run is marked failed |
| `endingStageIds` | `string[]` | No | Stage IDs that signal a successful conversation end |
| `personaCanHangUp` | `boolean` | No | Whether the tester persona is allowed to end the conversation (default: `false`) |
| `conversationOpener` | `string` | No | Opening message sent by the tester when the first stage awaits user input |
| `dataExtraction` | `DataExtractionEntry[]` | No | Variables to extract and optionally validate at the end of the conversation |
| `contextTransformerId` | `string` | No | ID of a context transformer applied before each tester turn |
| `dataPostProcessingExpected` | `Record<string, ExpectedValueEntry>` | No | Expected result shape after any post-processing step |
| `tags` | `string[]` | No | Tags for categorizing and filtering |
| `metadata` | `object` | No | Additional metadata |

**`DataExtractionEntry` object**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `stageId` | `string` | Yes | Stage from which to extract the variable |
| `varName` | `string` | Yes | Variable name to extract |
| `expectedValue` | `any` | No | Optional expected value for pass/fail comparison |
| `expectedMode` | `EvaluationComparisonMode` | No | Comparison mode for the expected value (default: `eq`) |

**`ExpectedValueEntry` object**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `value` | `any` | No | Expected value for comparison |
| `mode` | `EvaluationComparisonMode` | No | Comparison mode (default: `eq`) |

**`EvaluationComparisonMode` enum**

| Value | Description |
|-------|-------------|
| `exists` | Value is non-null |
| `not_exists` | Value is null/undefined |
| `eq` | Strict equality (default) |
| `contains` | String contains substring |
| `includes` | Array includes item |
| `matches` | Regex pattern match |
| `gt` | Greater than |
| `gte` | Greater than or equal |
| `lt` | Less than |
| `lte` | Less than or equal |
| `in` | Actual value is in expected array |
| `nin` | Actual value not in expected array |

**Response** `201 Created` — [Scenario Response](#scenario-response)

**Errors:** `400` Invalid body | `409` Already exists

## Get Scenario

```http
GET /api/projects/:projectId/scenarios/:id
```

**Required permission:** `scenario:read`

**Response** `200 OK` — [Scenario Response](#scenario-response)

**Errors:** `404` Not found

## List Scenarios

```http
GET /api/projects/:projectId/scenarios
```

**Required permission:** `scenario:read`

Supports [pagination & filtering](./pagination).

**Response** `200 OK` — [Scenario List Response](#scenario-list-response)

## Update Scenario

```http
PUT /api/projects/:projectId/scenarios/:id
Content-Type: application/json
```

**Required permission:** `scenario:write`

All create fields are optional plus `version` (required for optimistic locking).

**Response** `200 OK` — [Scenario Response](#scenario-response)

**Errors:** `400` | `404` | `409`

## Delete Scenario

```http
DELETE /api/projects/:projectId/scenarios/:id
Content-Type: application/json
```

**Required permission:** `scenario:delete`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | `integer` (min 1) | Yes | Current version for optimistic locking |

**Response** `204 No Content`

**Errors:** `404` | `409`

## Get Scenario Audit Logs

```http
GET /api/projects/:projectId/scenarios/:id/audit-logs
```

**Required permission:** `audit:read`

**Response** `200 OK` — Array of [Audit Log](./audit-logs) entries for this scenario

**Errors:** `404` Not found

---

## Scenario Response

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `id` | `string` | No | Unique identifier |
| `projectId` | `string` | No | Parent project ID |
| `name` | `string` | No | Display name |
| `description` | `string` | Yes | Description |
| `language` | `string` | No | Language code |
| `startingStageId` | `string` | No | Starting stage ID |
| `maxTurns` | `integer` | No | Maximum turn count |
| `endingStageIds` | `string[]` | No | Stage IDs that end the scenario successfully |
| `personaCanHangUp` | `boolean` | No | Whether the tester persona may hang up |
| `conversationOpener` | `string` | Yes | Opening message sent by the tester |
| `dataExtraction` | `DataExtractionEntry[]` | Yes | Data extraction configuration |
| `contextTransformerId` | `string` | Yes | Context transformer ID |
| `dataPostProcessingExpected` | `Record<string, ExpectedValueEntry>` | Yes | Expected post-processing result |
| `tags` | `string[]` | No | Tags |
| `metadata` | `object` | Yes | Additional metadata |
| `version` | `integer` | No | Optimistic locking version |
| `createdAt` | `string` (ISO 8601) | No | Creation timestamp |
| `updatedAt` | `string` (ISO 8601) | No | Last update timestamp |

## Scenario List Response

| Field | Type | Description |
|-------|------|-------------|
| `items` | `Scenario[]` | Page of scenario records |
| `total` | `integer` | Total matching record count |
| `limit` | `integer` | Page size |
| `offset` | `integer` | Page offset |
