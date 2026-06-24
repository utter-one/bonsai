# Scenario Runs & Conversations

Scenario Runs and Scenario Conversations are system-generated entities created when automated testing is triggered. They are read-only from the REST API perspective, except for the initial creation of a run.

**Tag:** `ScenarioRuns` / `ScenarioConversations` | **Scoped to:** Project

## Scenario Runs

A Scenario Run represents a single execution of a [Scenario](./scenarios) — it tracks which [Testers](./testers) participated, how many conversations were scheduled, and the overall pass/fail status.

### Create Scenario Run

```http
POST /api/projects/:projectId/scenario-runs
Content-Type: application/json
```

**Required permission:** `scenario_run:write`

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `scenarioId` | `string` (min 1) | Yes | ID of the scenario to run |
| `testers` | `Record<string, number>` | Yes | Map of tester persona ID (non-empty string) to number of conversations (positive integer ≥ 1) to run for that tester. At least one tester required. |
| `metadata` | `object` | No | Additional metadata |

**Response** `201 Created` — [Scenario Run Response](#scenario-run-response)

**Errors:** `400` Invalid body

### Get Scenario Run

```http
GET /api/projects/:projectId/scenario-runs/:id
```

**Required permission:** `scenario_run:read`

**Response** `200 OK` — [Scenario Run Response](#scenario-run-response)

**Errors:** `404` Not found

### List Scenario Runs

```http
GET /api/projects/:projectId/scenario-runs
```

**Required permission:** `scenario_run:read`

Supports [pagination & filtering](./pagination).

**Response** `200 OK` — [Scenario Run List Response](#scenario-run-list-response)

### Cancel Scenario Run

```http
POST /api/projects/:projectId/scenario-runs/:id/cancel
```

**Required permission:** `scenario_run:write`

Cancels a scenario run that is currently queued or in progress. Already-running conversation slots will complete but no new slots will start.

**Response** `200 OK` — [Scenario Run Response](#scenario-run-response)

**Errors:** `404` Not found | `409` Run is in a terminal state

### Delete Scenario Run

```http
DELETE /api/projects/:projectId/scenario-runs/:id
```

**Required permission:** `scenario_run:write`

Permanently deletes a scenario run and all its associated conversations. Only runs in terminal states (passed, failed, cancelled) can be deleted.

**Response** `204 No Content`

**Errors:** `404` Not found | `409` Run is not in a terminal state — cancel it first

### Get Scheduler Status

```http
GET /api/scenario-runs/scheduler
```

**Required permission:** `system:config`

Returns whether the scenario run scheduler (circuit breaker) is currently enabled.

**Response** `200 OK`

```json
{
  "enabled": true
}
```

### Update Scheduler Status

```http
PUT /api/scenario-runs/scheduler
Content-Type: application/json
```

**Required permission:** `system:config`

Enables or disables the scenario run scheduler circuit breaker. Disabling stops new executions from starting; in-flight runs complete normally.

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `enabled` | `boolean` | Yes | Set to `true` to enable, `false` to disable |

**Response** `200 OK` — `{ "enabled": boolean }`

**Errors:** `400` Invalid body

---

## Scenario Conversations

A Scenario Conversation represents one individual conversation executed as part of a Scenario Run. It records which tester was used, the associated conversation ID, status, and any extracted or transformed data.

### Get Scenario Conversation

```http
GET /api/projects/:projectId/scenario-conversations/:id
```

**Required permission:** `scenario_run:read`

**Response** `200 OK` — [Scenario Conversation Response](#scenario-conversation-response)

**Errors:** `404` Not found

### List Scenario Conversations

```http
GET /api/projects/:projectId/scenario-conversations
```

**Required permission:** `scenario_run:read`

Supports [pagination & filtering](./pagination).

**Additional query parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `scenarioRunId` | `string` | Filter conversations to a specific scenario run |

**Response** `200 OK` — [Scenario Conversation List Response](#scenario-conversation-list-response)

---

## Status Values

Both Scenario Runs and Scenario Conversations share the same status lifecycle:

| Status | Description |
|--------|-------------|
| `queued` | Created and awaiting execution |
| `in_progress` | Currently being executed |
| `passed` | Completed and all assertions passed |
| `failed` | Completed but one or more assertions failed, or the run was aborted |
| `cancelled` | Run was cancelled by an operator |
| `error` | Run encountered an unrecoverable error |

---

## Scenario Run Response

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `id` | `string` | No | Unique identifier |
| `projectId` | `string` | No | Parent project ID |
| `scenarioId` | `string` | No | Scenario that was executed |
| `testers` | `Record<string, number>` | No | Map of tester persona ID to number of conversations assigned |
| `totalConversations` | `integer` | No | Computed total number of conversations across all testers |
| `status` | `string` | No | Run status (`queued` \| `in_progress` \| `passed` \| `failed` \| `cancelled` \| `error`) |
| `statusDetails` | `string` | Yes | Human-readable details about the current status |
| `errorCount` | `integer` | No | Number of conversations that errored (excluded from pass/fail) |
| `testStatistics` | `object` | Yes | Test statistics: `passedTests`, `failedTests` |
| `metadata` | `object` | Yes | Additional metadata |
| `version` | `integer` | No | Optimistic locking version |
| `createdAt` | `string` (ISO 8601) | No | Creation timestamp |
| `updatedAt` | `string` (ISO 8601) | No | Last update timestamp |

## Scenario Run List Response

| Field | Type | Description |
|-------|------|-------------|
| `items` | `ScenarioRun[]` | Page of scenario run records |
| `total` | `integer` | Total matching record count |
| `limit` | `integer` | Page size |
| `offset` | `integer` | Page offset |

## Scenario Conversation Response

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `id` | `string` | No | Unique identifier |
| `projectId` | `string` | No | Parent project ID |
| `scenarioRunId` | `string` | No | Parent scenario run ID |
| `scenarioId` | `string` | No | Scenario that was executed |
| `testerId` | `string` | No | Tester used for this conversation |
| `conversationId` | `string` | Yes | Linked conversation ID (set once the conversation starts) |
| `status` | `string` | No | Status (`queued` \| `in_progress` \| `passed` \| `failed` \| `cancelled` \| `error`) |
| `testRunStatus` | `string` | Yes | How the test ended: `conversation_ended`, `conversation_aborted`, `conversation_failed`, `max_turns_reached`, `tester_hung_up` |
| `dataExtractionResults` | `object` | Yes | Variables extracted at the end of the conversation |
| `dataTransformationResults` | `object` | Yes | Results after any post-processing transformation |
| `testStatistics` | `object` | Yes | Test statistics: `passedTests`, `failedTests` |
| `metadata` | `object` | Yes | Additional metadata |
| `version` | `integer` | No | Optimistic locking version |
| `createdAt` | `string` (ISO 8601) | No | Creation timestamp |
| `updatedAt` | `string` (ISO 8601) | No | Last update timestamp |

## Scenario Conversation List Response

| Field | Type | Description |
|-------|------|-------------|
| `items` | `ScenarioConversation[]` | Page of scenario conversation records |
| `total` | `integer` | Total matching record count |
| `limit` | `integer` | Page size |
| `offset` | `integer` | Page offset |
