# Benchmark

The benchmark system allows you to create test suites that measure provider performance (LLM, TTS, ASR) across repeated iterations with statistical analysis.

All endpoints require the `system:admin` permission.

## Concepts

### Benchmark Suite

A suite is a named collection of test cases with an optional cron schedule for automated execution.

### Benchmark Provider Config

A provider config defines which provider to test and its settings (model, voice, language, etc.). Reusable across multiple test cases.

### Benchmark Config

A config (test case) defines the input data and repeat count for a single benchmark. Belongs to a suite.

### Benchmark Run

A run is a single execution of all configs in a suite. Can be triggered manually or by schedule.

### Benchmark Config Execution

One execution per config per run. Contains aggregated statistics over all iterations.

### Benchmark Result

Individual iteration result with timing data and provider-specific output.

## Endpoints

### Benchmark Suites

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/benchmark/suites` | List benchmark suites |
| POST | `/api/benchmark/suites` | Create a benchmark suite |
| GET | `/api/benchmark/suites/:id` | Get a benchmark suite |
| PUT | `/api/benchmark/suites/:id` | Update a benchmark suite |
| DELETE | `/api/benchmark/suites/:id` | Delete a benchmark suite |

### Benchmark Provider Configs

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/benchmark/provider-configs` | List provider configs |
| POST | `/api/benchmark/provider-configs` | Create a provider config |
| GET | `/api/benchmark/provider-configs/:id` | Get a provider config |
| PUT | `/api/benchmark/provider-configs/:id` | Update a provider config |
| DELETE | `/api/benchmark/provider-configs/:id` | Delete a provider config |

### Benchmark Configs

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/benchmark/configs` | List benchmark configs |
| POST | `/api/benchmark/configs` | Create a benchmark config |
| GET | `/api/benchmark/configs/:id` | Get a benchmark config |
| PUT | `/api/benchmark/configs/:id` | Update a benchmark config |
| DELETE | `/api/benchmark/configs/:id` | Delete a benchmark config |

### Benchmark Runs

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/benchmark/runs` | List benchmark runs |
| POST | `/api/benchmark/runs` | Trigger a benchmark run |
| GET | `/api/benchmark/runs/:id` | Get a benchmark run |

### Benchmark Results

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/benchmark/config-executions/:executionId/results` | List iteration results for a config execution |

---

## Benchmark Suites

### List Benchmark Suites

```
GET /api/benchmark/suites
```

**Required permission:** `system:admin`

#### Query Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `offset` | `integer` | Pagination offset (default: 0) |
| `limit` | `integer` | Page size (default: 50, max: 200) |
| `search` | `string` | Filter by name or description |
| `tags[]` | `string[]` | Filter by tags (AND logic) |

#### Response

| Field | Type | Description |
|-------|------|-------------|
| `items` | `BenchmarkSuite[]` | Suites in the current page |
| `total` | `integer` | Total number of matching suites |
| `offset` | `integer` | Current page offset |
| `limit` | `integer` | Page size |

### Create Benchmark Suite

```
POST /api/benchmark/suites
Content-Type: application/json
```

**Required permission:** `system:admin`

#### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` (min 1) | Yes | Human-readable name |
| `description` | `string` | No | Description of what this suite tests |
| `cronExpression` | `string` | No | node-cron expression for scheduled execution (e.g. `0 * * * *`) |
| `isActive` | `boolean` | No (default: `true`) | Whether the suite is active |
| `tags` | `string[]` | No (default: `[]`) | Tags for filtering |

#### Response

`BenchmarkSuite` object

### Benchmark Suite Response

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique suite ID |
| `name` | `string` | Suite name |
| `description` | `string` or `null` | Suite description |
| `cronExpression` | `string` or `null` | Cron expression for scheduled runs |
| `isActive` | `boolean` | Whether the suite is active |
| `tags` | `string[]` | Tags |
| `createdBy` | `string` or `null` | Operator ID who created the suite |
| `version` | `integer` | Optimistic locking version |
| `createdAt` | `string` (ISO 8601) | Creation timestamp |
| `updatedAt` | `string` (ISO 8601) | Last update timestamp |

### Update Benchmark Suite

```
PUT /api/benchmark/suites/:id
Content-Type: application/json
```

**Required permission:** `system:admin`

#### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | `integer` | Yes | Current version for optimistic locking |
| `name` | `string` (min 1) | No | Updated name |
| `description` | `string` or `null` | No | Updated description |
| `cronExpression` | `string` or `null` | No | Updated cron expression (null to remove) |
| `isActive` | `boolean` | No | Updated active flag |
| `tags` | `string[]` | No | Updated tags |

#### Response

`BenchmarkSuite` object

**Errors:** `404` Not found | `409` Version conflict

### Delete Benchmark Suite

```
DELETE /api/benchmark/suites/:id
```

**Required permission:** `system:admin`

**Response:** `204 No Content`

**Errors:** `404` Not found

---

## Benchmark Provider Configs

### List Provider Configs

```
GET /api/benchmark/provider-configs
```

**Required permission:** `system:admin`

#### Query Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `offset` | `integer` | Pagination offset |
| `limit` | `integer` | Page size |
| `search` | `string` | Filter by name |
| `providerType` | `string` | Filter by type: `llm`, `tts`, `asr` |

#### Response

| Field | Type | Description |
|-------|------|-------------|
| `items` | `BenchmarkProviderConfig[]` | Provider configs in the current page |
| `total` | `integer` | Total matching |
| `offset` | `integer` | Current offset |
| `limit` | `integer` | Page size |

### Create Provider Config

```
POST /api/benchmark/provider-configs
Content-Type: application/json
```

**Required permission:** `system:admin`

#### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` (min 1) | Yes | Human-readable name |
| `providerType` | `string` | Yes | Provider type: `llm`, `tts`, `asr` |
| `providerId` | `string` (min 1) | Yes | ID of the provider entity |
| `settings` | `Record<string, unknown>` | Yes | Provider-specific settings (model, voice, etc.) |
| `providerSettings` | `Record<string, unknown>` | No | Additional provider-specific configuration |

#### Response

`BenchmarkProviderConfig` object

### Benchmark Provider Config Response

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique ID |
| `name` | `string` | Name |
| `providerType` | `string` | Provider type: `llm`, `tts`, `asr` |
| `providerId` | `string` | Provider entity ID |
| `settings` | `Record<string, unknown>` | Provider settings |
| `providerSettings` | `Record<string, unknown>` or `null` | Additional configuration |
| `version` | `integer` | Optimistic locking version |
| `createdAt` | `string` (ISO 8601) | Creation timestamp |
| `updatedAt` | `string` (ISO 8601) | Last update timestamp |

### Update Provider Config

```
PUT /api/benchmark/provider-configs/:id
Content-Type: application/json
```

**Required permission:** `system:admin`

#### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | `integer` | Yes | Current version for optimistic locking |
| `name` | `string` (min 1) | No | Updated name |
| `providerId` | `string` (min 1) | No | Updated provider ID |
| `settings` | `Record<string, unknown>` | No | Updated settings |
| `providerSettings` | `Record<string, unknown>` or `null` | No | Updated configuration (null to clear) |

#### Response

`BenchmarkProviderConfig` object

**Errors:** `404` Not found | `409` Version conflict

### Delete Provider Config

```
DELETE /api/benchmark/provider-configs/:id
```

**Required permission:** `system:admin`

**Response:** `204 No Content`

**Errors:** `404` Not found

---

## Benchmark Configs

### List Benchmark Configs

```
GET /api/benchmark/configs
```

**Required permission:** `system:admin`

#### Query Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `offset` | `integer` | Pagination offset |
| `limit` | `integer` | Page size |
| `suiteId` | `string` | Filter by suite ID |
| `search` | `string` | Filter by name |

#### Response

| Field | Type | Description |
|-------|------|-------------|
| `items` | `BenchmarkConfig[]` | Configs in the current page |
| `total` | `integer` | Total matching |
| `offset` | `integer` | Current offset |
| `limit` | `integer` | Page size |

### Create Benchmark Config

```
POST /api/benchmark/configs
Content-Type: application/json
```

**Required permission:** `system:admin`

#### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `suiteId` | `string` (min 1) | Yes | Parent suite ID |
| `name` | `string` (min 1) | Yes | Test case name |
| `description` | `string` | No | Description |
| `providerConfigId` | `string` (min 1) | Yes | Provider config ID |
| `inputType` | `string` | Yes | Input type: `messages` (LLM), `text` (TTS), `audio` (ASR) |
| `inputData` | `Record<string, unknown>` | Yes | Input payload (see below) |
| `repeats` | `integer` (1–100) | No (default: 3) | Repeat count per run |

**Input data by type:**
- **LLM (`messages`):** `{ messages: LlmMessage[] }`
- **TTS (`text`):** `{ text: string }`
- **ASR (`audio`):** `{ audioBase64: string, mimeType: string, fileName?: string }`

#### Response

`BenchmarkConfig` object

**Errors:** `404` Suite not found

### Benchmark Config Response

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique ID |
| `suiteId` | `string` | Parent suite ID |
| `name` | `string` | Name |
| `description` | `string` or `null` | Description |
| `providerConfigId` | `string` | Provider config ID |
| `inputType` | `string` | Input type: `messages`, `text`, `audio` |
| `inputData` | `Record<string, unknown>` | Input payload |
| `repeats` | `integer` | Repeat count per run |
| `version` | `integer` | Optimistic locking version |
| `createdAt` | `string` (ISO 8601) | Creation timestamp |
| `updatedAt` | `string` (ISO 8601) | Last update timestamp |

### Update Benchmark Config

```
PUT /api/benchmark/configs/:id
Content-Type: application/json
```

**Required permission:** `system:admin`

#### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | `integer` | Yes | Current version for optimistic locking |
| `name` | `string` (min 1) | No | Updated name |
| `description` | `string` or `null` | No | Updated description |
| `providerConfigId` | `string` (min 1) | No | Updated provider config |
| `inputType` | `string` | No | Updated input type |
| `inputData` | `Record<string, unknown>` | No | Updated input data |
| `repeats` | `integer` (1–100) | No | Updated repeat count |

#### Response

`BenchmarkConfig` object

**Errors:** `404` Not found | `409` Version conflict

### Delete Benchmark Config

```
DELETE /api/benchmark/configs/:id
```

**Required permission:** `system:admin`

**Response:** `204 No Content`

**Errors:** `404` Not found

---

## Benchmark Runs

### List Benchmark Runs

```
GET /api/benchmark/runs
```

**Required permission:** `system:admin`

#### Query Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `offset` | `integer` | Pagination offset |
| `limit` | `integer` | Page size |
| `suiteId` | `string` | Filter by suite ID |
| `status` | `string` | Filter by status: `pending`, `in_progress`, `completed`, `failed` |

#### Response

| Field | Type | Description |
|-------|------|-------------|
| `items` | `BenchmarkRun[]` | Runs in the current page |
| `total` | `integer` | Total matching |
| `offset` | `integer` | Current offset |
| `limit` | `integer` | Page size |

### Trigger Benchmark Run

```
POST /api/benchmark/runs
Content-Type: application/json
```

**Required permission:** `system:admin`

Triggers a manual execution of all configs in the specified suite.

#### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `suiteId` | `string` (min 1) | Yes | Suite ID to execute |

#### Response

`BenchmarkRun` object

**Errors:** `404` Suite not found | `409` Run already in progress

### Get Benchmark Run

```
GET /api/benchmark/runs/:id
```

**Required permission:** `system:admin`

Returns the run with embedded config executions.

#### Response

`BenchmarkRun` object (with `executions` array)

**Errors:** `404` Not found

### Benchmark Run Response

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique run ID |
| `suiteId` | `string` | Suite ID |
| `trigger` | `string` | How the run was triggered: `manual`, `scheduled` |
| `status` | `string` | Status: `pending`, `in_progress`, `completed`, `failed` |
| `startedAt` | `string` or `null` | When the run started |
| `completedAt` | `string` or `null` | When the run completed |
| `error` | `string` or `null` | Top-level error message |
| `executions` | `BenchmarkConfigExecution[]` | Config executions (included on single-run GET) |
| `version` | `integer` | Optimistic locking version |
| `createdAt` | `string` (ISO 8601) | Creation timestamp |
| `updatedAt` | `string` (ISO 8601) | Last update timestamp |

### Benchmark Config Execution

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique execution ID |
| `runId` | `string` | Parent run ID |
| `configId` | `string` | Benchmark config ID |
| `status` | `string` | Status: `pending`, `in_progress`, `completed`, `failed` |
| `stats` | `BenchmarkStats` or `null` | Aggregated statistics |
| `startedAt` | `string` or `null` | When execution started |
| `completedAt` | `string` or `null` | When execution completed |
| `error` | `string` or `null` | Error message |
| `version` | `integer` | Optimistic locking version |
| `createdAt` | `string` (ISO 8601) | Creation timestamp |
| `updatedAt` | `string` (ISO 8601) | Last update timestamp |

### Benchmark Stats

| Field | Type | Description |
|-------|------|-------------|
| `totalDurationMs` | `TimingStats` | Total iteration duration statistics |
| `timeToFirstChunkMs` | `TimingStats` or `null` | Time-to-first-chunk statistics (null for non-streaming) |
| `chunkIntervalMs` | `TimingStats` or `null` | Inter-chunk interval statistics (null for < 2 chunks) |
| `successRate` | `number` (0–1) | Fraction of successful iterations |
| `completedIterations` | `integer` | Number of successful iterations |
| `failedIterations` | `integer` | Number of failed iterations |

### Timing Stats

| Field | Type | Description |
|-------|------|-------------|
| `avg` | `number` | Mean in milliseconds |
| `median` | `number` | Median (p50) in milliseconds |
| `p50` | `number` | 50th percentile in milliseconds |
| `p95` | `number` | 95th percentile in milliseconds |
| `p99` | `number` | 99th percentile in milliseconds |
| `min` | `number` | Minimum in milliseconds |
| `max` | `number` | Maximum in milliseconds |

---

## Benchmark Results

### List Iteration Results

```
GET /api/benchmark/config-executions/:executionId/results
```

**Required permission:** `system:admin`

#### Response

| Field | Type | Description |
|-------|------|-------------|
| `items` | `BenchmarkResult[]` | Iteration results |
| `total` | `integer` | Total iterations |

**Errors:** `404` Config execution not found

### Benchmark Result

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique result ID |
| `configExecutionId` | `string` | Parent config execution ID |
| `iterationIndex` | `integer` | Zero-based iteration index |
| `startedAt` | `string` (ISO 8601) | When iteration started |
| `completedAt` | `string` or `null` | When iteration completed |
| `result` | `IterationResultData` | Full iteration result |

### Iteration Result Data

| Field | Type | Description |
|-------|------|-------------|
| `error` | `string` or `null` | Error message (null on success) |
| `timeToFirstChunkMs` | `integer` or `null` | Milliseconds to first chunk/token |
| `chunkCount` | `integer` | Total chunks received |
| `chunkTimings` | `number[]` | Milliseconds between consecutive chunks |
| `output` | `object` or `null` | Provider-specific output (see below) |

#### LLM Output

| Field | Type | Description |
|-------|------|-------------|
| `text` | `string` | Generated text |
| `charCount` | `integer` | Character count |
| `wordCount` | `integer` | Word count |
| `stopReason` | `string` or `null` | Reason generation stopped |
| `inputTokens` | `integer` or `null` | Prompt tokens |
| `outputTokens` | `integer` or `null` | Completion tokens |
| `tokensPerSecond` | `number` or `null` | Output tokens per second |

#### TTS Output

| Field | Type | Description |
|-------|------|-------------|
| `byteCount` | `integer` | Total audio bytes synthesised |
| `inputCharCount` | `integer` | Input text character count |
| `bytesPerSecond` | `number` or `null` | Synthesis throughput |

#### ASR Output

| Field | Type | Description |
|-------|------|-------------|
| `text` | `string` | Recognised transcript |
| `charCount` | `integer` | Transcript character count |
| `wordCount` | `integer` | Transcript word count |
| `partialCount` | `integer` | Partial recognition events |
| `finalCount` | `integer` | Final recognition events |
