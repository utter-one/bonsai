# Analytics Query Engine

The slice-and-dice analytics query engine provides a generic interface for aggregating data from conversations and conversation events. Instead of fixed endpoints with hardcoded metrics, you choose a **source**, pick **metrics** to aggregate, optionally **group by** dimensions, and bucket results into **time intervals**.

All endpoints are scoped to a project and require the `analytics:read` permission.

| Scoped to: Project |
|---|

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/projects/:projectId/analytics/sources` | Get available sources, dimensions, and metrics |
| GET | `/api/projects/:projectId/analytics/query` | Execute a slice-and-dice analytics query |

---

## Concepts

### Sources

A source is a named dataset that exposes a set of **dimensions** (categorical fields you can group by or filter on) and **metrics** (numeric fields you can aggregate). Available sources:

| Source | Description |
|--------|-------------|
| `conversations` | Conversation-level aggregations: counts, durations, and outcomes |
| `events` | All conversation events: count and slice by event type |
| `turns` | Turn-level timing and token metrics from assistant messages |
| `tool_calls` | Tool execution: duration, success/failure rates, token usage |
| `classifications` | Classifier execution: duration, token usage, firing rates |
| `transformations` | Context transformer execution: duration and token usage |
| `moderation` | Content moderation checks: flag rates and durations |
| `stage_visits` | Stage navigation: visit counts and time spent on each stage |

### Metric Specifications

Metrics are requested as strings in the format <code v-pre>{aggFn}:{metricId}</code> or the bare keyword `count`.

| Format | Description | Example |
|--------|-------------|---------|
| `count` | Count of rows matching the group | `count` |
| <code v-pre>avg:{metricId}</code> | Average of the metric | `avg:totalTurnDurationMs` |
| <code v-pre>sum:{metricId}</code> | Sum of the metric | `sum:promptTokens` |
| <code v-pre>min:{metricId}</code> | Minimum value | `min:durationMs` |
| <code v-pre>max:{metricId}</code> | Maximum value | `max:durationMs` |
| <code v-pre>p50:{metricId}</code> | 50th percentile (median) | `p50:llmDurationMs` |
| <code v-pre>p75:{metricId}</code> | 75th percentile | `p75:llmDurationMs` |
| <code v-pre>p90:{metricId}</code> | 90th percentile | `p90:totalTurnDurationMs` |
| <code v-pre>p95:{metricId}</code> | 95th percentile | `p95:timeToFirstTokenMs` |
| <code v-pre>p99:{metricId}</code> | 99th percentile | `p99:timeToFirstTokenMs` |

### Dimensions

Dimensions are categorical fields used for grouping and filtering. Each source has its own set of dimensions directly on the rows.

::: tip
Use the `GET /analytics/sources` endpoint to discover all available dimensions and metrics for each source at runtime.
:::

---

## Get Source Catalog

```
GET /api/projects/:projectId/analytics/sources
```

Returns the full catalog of available analytics sources with their queryable dimensions and metrics. Use this to build dynamic UIs or discover what can be queried.

### Response

| Field | Type | Description |
|-------|------|-------------|
| `sources` | `SourceEntry[]` | List of all available analytics sources |

### Source Entry

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Source identifier (used in the `source` query parameter) |
| `label` | `string` | Human-readable label |
| `description` | `string` | Description of what this source provides |
| `dimensions` | `SourceDimension[]` | Available dimensions for groupBy and filtering |
| `metrics` | `SourceMetric[]` | Available numeric metrics for aggregation |

### Source Dimension

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Dimension identifier (used in `groupBy[]` and `filters`) |
| `label` | `string` | Human-readable label |
| `values` | `string[]` (optional) | Known enumerable values, if applicable |

### Source Metric

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Metric identifier (used after the colon in metric specs) |
| `label` | `string` | Human-readable label |
| `unit` | `string` | Unit of measurement: `ms`, `tokens`, `count`, or `boolean` |

### Example

```bash
curl "http://localhost:3000/api/projects/my-project/analytics/sources" \
  -H "Authorization: Bearer eyJhbG..."
```

```json
{
  "sources": [
    {
      "id": "turns",
      "label": "Turns",
      "description": "Turn-level timing and token metrics from assistant message events.",
      "dimensions": [
        { "id": "conversationId", "label": "Conversation ID" },
        { "id": "source", "label": "Input Source", "values": ["text", "voice"] },
        { "id": "model", "label": "LLM Model" },
        { "id": "provider", "label": "LLM Provider" }
      ],
      "metrics": [
        { "id": "totalTurnDurationMs", "label": "Total Turn Duration", "unit": "ms" },
        { "id": "llmDurationMs", "label": "LLM Duration", "unit": "ms" },
        { "id": "promptTokens", "label": "Prompt Tokens", "unit": "tokens" }
      ]
    },
    {
      "id": "tool_calls",
      "label": "Tool Calls",
      "description": "Tool execution metrics: duration, success/failure rates, and token usage.",
      "dimensions": [
        { "id": "toolName", "label": "Tool Name" },
        { "id": "toolType", "label": "Tool Type", "values": ["smart_function", "webhook", "script"] },
        { "id": "success", "label": "Success", "values": ["true", "false"] }
      ],
      "metrics": [
        { "id": "durationMs", "label": "Execution Duration", "unit": "ms" },
        { "id": "promptTokens", "label": "Prompt Tokens", "unit": "tokens" }
      ]
    }
  ]
}
```

---

## Execute Analytics Query

```
GET /api/projects/:projectId/analytics/query
```

Executes a slice-and-dice query against the specified source. Returns flat rows with dimension values and computed metric aggregations, optionally bucketed by time interval.

### Query Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `source` | `string` | **Yes** | — | Source to query (see source catalog) |
| `metrics[]` | `string[]` | **Yes** | — | Metric specs to compute (min 1, max 10) |
| `groupBy[]` | `string[]` | No | `[]` | Dimension IDs to group by (max 5) |
| `interval` | `string` | No | — | Time bucket interval: `hour`, `day`, `week`, `month` |
| `from` | `string` (ISO 8601) | No | — | Start of the date range (inclusive) |
| `to` | `string` (ISO 8601) | No | — | End of the date range (inclusive) |
| `conversationId` | `string` | No | — | Filter to a single conversation |
| `filters[dimId]` | `string` | No | — | Equality filter on a dimension |
| `limit` | `integer` | No | `1000` | Maximum rows to return (1–10,000) |

### Response

| Field | Type | Description |
|-------|------|-------------|
| `source` | `string` | Source that was queried |
| `interval` | `string` (optional) | Time bucket interval used |
| `groupBy` | `string[]` | Dimensions that results are grouped by |
| `metrics` | `string[]` | Metric specifications that were computed |
| `rows` | `SliceQueryRow[]` | Result rows |

### Slice Query Row

| Field | Type | Description |
|-------|------|-------------|
| `bucket` | `string \| null` | Time bucket start (ISO 8601) if interval is set, `null` otherwise |
| `dimensions` | `Record<string, string \| null>` | Dimension values for this group |
| `metrics` | `Record<string, number \| null>` | Computed metric values, keyed by the metric spec |

::: tip
Metric response keys exactly match the spec strings from your request. For example, requesting `avg:llmDurationMs` returns `"avg:llmDurationMs": 1200.5` in the metrics map.
:::

::: warning
When a dimension value is absent (e.g. no LLM model recorded), it appears as `null` in the dimensions map. This is useful for identifying "unknown" groups.
:::

### Examples

#### Daily turn counts

```bash
curl "http://localhost:3000/api/projects/my-project/analytics/query?\
source=turns&\
metrics[]=count&\
interval=day&\
from=2025-01-01T00:00:00Z&\
to=2025-01-07T23:59:59Z" \
  -H "Authorization: Bearer eyJhbG..."
```

```json
{
  "source": "turns",
  "interval": "day",
  "groupBy": [],
  "metrics": ["count"],
  "rows": [
    { "bucket": "2025-01-01T00:00:00.000Z", "dimensions": {}, "metrics": { "count": 180 } },
    { "bucket": "2025-01-02T00:00:00.000Z", "dimensions": {}, "metrics": { "count": 210 } },
    { "bucket": "2025-01-03T00:00:00.000Z", "dimensions": {}, "metrics": { "count": 195 } }
  ]
}
```

#### Tool calls by type and success rate

```bash
curl "http://localhost:3000/api/projects/my-project/analytics/query?\
source=tool_calls&\
groupBy[]=toolType&\
groupBy[]=success&\
metrics[]=count&\
metrics[]=avg:durationMs" \
  -H "Authorization: Bearer eyJhbG..."
```

```json
{
  "source": "tool_calls",
  "groupBy": ["toolType", "success"],
  "metrics": ["count", "avg:durationMs"],
  "rows": [
    {
      "bucket": null,
      "dimensions": { "toolType": "smart_function", "success": "true" },
      "metrics": { "count": 450, "avg:durationMs": 1203.45 }
    },
    {
      "bucket": null,
      "dimensions": { "toolType": "smart_function", "success": "false" },
      "metrics": { "count": 12, "avg:durationMs": 5120.8 }
    },
    {
      "bucket": null,
      "dimensions": { "toolType": "webhook", "success": "true" },
      "metrics": { "count": 220, "avg:durationMs": 340.2 }
    }
  ]
}
```

#### Conversation outcomes

```bash
curl "http://localhost:3000/api/projects/my-project/analytics/query?\
source=conversations&\
groupBy[]=status&\
metrics[]=count&\
metrics[]=avg:durationMs" \
  -H "Authorization: Bearer eyJhbG..."
```

```json
{
  "source": "conversations",
  "groupBy": ["status"],
  "metrics": ["count", "avg:durationMs"],
  "rows": [
    { "bucket": null, "dimensions": { "status": "finished" }, "metrics": { "count": 1200, "avg:durationMs": 45230.5 } },
    { "bucket": null, "dimensions": { "status": "aborted" }, "metrics": { "count": 85, "avg:durationMs": 12400.1 } },
    { "bucket": null, "dimensions": { "status": "failed" }, "metrics": { "count": 15, "avg:durationMs": 3200.0 } }
  ]
}
```

#### Latency by LLM model with time trend

```bash
curl "http://localhost:3000/api/projects/my-project/analytics/query?\
source=turns&\
groupBy[]=model&\
interval=day&\
metrics[]=count&\
metrics[]=avg:llmDurationMs&\
metrics[]=p95:timeToFirstTokenMs&\
from=2025-01-01T00:00:00Z&\
to=2025-01-03T23:59:59Z" \
  -H "Authorization: Bearer eyJhbG..."
```

```json
{
  "source": "turns",
  "interval": "day",
  "groupBy": ["model"],
  "metrics": ["count", "avg:llmDurationMs", "p95:timeToFirstTokenMs"],
  "rows": [
    {
      "bucket": "2025-01-01T00:00:00.000Z",
      "dimensions": { "model": "gpt-4" },
      "metrics": { "count": 120, "avg:llmDurationMs": 1450.3, "p95:timeToFirstTokenMs": 980.0 }
    },
    {
      "bucket": "2025-01-01T00:00:00.000Z",
      "dimensions": { "model": "claude-3-5-sonnet-20241022" },
      "metrics": { "count": 60, "avg:llmDurationMs": 1100.8, "p95:timeToFirstTokenMs": 720.0 }
    },
    {
      "bucket": "2025-01-02T00:00:00.000Z",
      "dimensions": { "model": "gpt-4" },
      "metrics": { "count": 135, "avg:llmDurationMs": 1380.1, "p95:timeToFirstTokenMs": 940.0 }
    }
  ]
}
```

#### Stage visit durations

```bash
curl "http://localhost:3000/api/projects/my-project/analytics/query?\
source=stage_visits&\
groupBy[]=stageId&\
metrics[]=count&\
metrics[]=avg:timeOnStageMs" \
  -H "Authorization: Bearer eyJhbG..."
```

```json
{
  "source": "stage_visits",
  "groupBy": ["stageId"],
  "metrics": ["count", "avg:timeOnStageMs"],
  "rows": [
    { "bucket": null, "dimensions": { "stageId": "stg_greeting" }, "metrics": { "count": 500, "avg:timeOnStageMs": 8200.5 } },
    { "bucket": null, "dimensions": { "stageId": "stg_booking" }, "metrics": { "count": 320, "avg:timeOnStageMs": 45000.2 } },
    { "bucket": null, "dimensions": { "stageId": "stg_farewell" }, "metrics": { "count": 480, "avg:timeOnStageMs": 3100.0 } }
  ]
}
```

#### Filter to a single conversation

```bash
curl "http://localhost:3000/api/projects/my-project/analytics/query?\
source=classifications&\
conversationId=conv_abc123&\
groupBy[]=classifierName&\
metrics[]=count&\
metrics[]=sum:totalTokens" \
  -H "Authorization: Bearer eyJhbG..."
```

```json
{
  "source": "classifications",
  "groupBy": ["classifierName"],
  "metrics": ["count", "sum:totalTokens"],
  "rows": [
    { "bucket": null, "dimensions": { "classifierName": "Intent Classifier" }, "metrics": { "count": 8, "sum:totalTokens": 3420 } },
    { "bucket": null, "dimensions": { "classifierName": "Sentiment Classifier" }, "metrics": { "count": 8, "sum:totalTokens": 1890 } }
  ]
}
```

---

## Source Reference

### conversations

| Dimensions | Metrics |
|---|---|
| `status`, `startingStageId`, `endingStageId` | `durationMs` |

### events

| Dimensions | Metrics |
|---|---|
| `conversationId`, `stageId`, `eventType` | *(none — use `count`)* |

### turns

| Dimensions | Metrics |
|---|---|
| `conversationId`, `stageId`, `source`, `model`, `provider`, `prescripted` | `totalTurnDurationMs`, `timeToFirstTokenMs`, `timeToFirstTokenFromTurnStartMs`, `timeToFirstAudioMs`, `llmDurationMs`, `ttsDurationMs`, `ttsConnectDurationMs`, `promptRenderDurationMs`, `moderationDurationMs`, `stageTransitionDurationMs`, `processingDurationMs`, `actionsDurationMs`, `asrDurationMs`, `promptTokens`, `completionTokens`, `totalTokens` |

### tool_calls

| Dimensions | Metrics |
|---|---|
| `conversationId`, `stageId`, `toolId`, `toolName`, `toolType`, `success`, `sourceActionName` | `durationMs`, `promptTokens`, `completionTokens`, `totalTokens` |

### classifications

| Dimensions | Metrics |
|---|---|
| `conversationId`, `stageId`, `classifierId`, `classifierName`, `model`, `provider` | `durationMs`, `promptTokens`, `completionTokens`, `totalTokens` |

### transformations

| Dimensions | Metrics |
|---|---|
| `conversationId`, `stageId`, `transformerId`, `transformerName`, `model`, `provider` | `durationMs`, `promptTokens`, `completionTokens`, `totalTokens` |

### moderation

| Dimensions | Metrics |
|---|---|
| `conversationId`, `stageId`, `flagged` | `durationMs` |

### stage_visits

| Dimensions | Metrics |
|---|---|
| `conversationId`, `stageId` | `timeOnStageMs` |
