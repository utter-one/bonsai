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
| `testerIds` | `string[]` (min 1) | Yes | IDs of testers that will participate |
| `totalConversations` | `integer` (min 1) | Yes | Total number of conversations to execute |
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

---

## Scenario Run Response

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `id` | `string` | No | Unique identifier |
| `projectId` | `string` | No | Parent project ID |
| `scenarioId` | `string` | No | Scenario that was executed |
| `testerIds` | `string[]` | No | Tester IDs that participated |
| `totalConversations` | `integer` | No | Total scheduled conversation count |
| `status` | `string` | No | Run status (`queued` \| `in_progress` \| `passed` \| `failed`) |
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
| `status` | `string` | No | Conversation status (`queued` \| `in_progress` \| `passed` \| `failed`) |
| `dataExtractionResults` | `object` | Yes | Variables extracted at the end of the conversation |
| `dataTransformationResults` | `object` | Yes | Results after any post-processing transformation |
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
