# Analytics

Analytics endpoints provide aggregated latency metrics and per-conversation timing breakdowns for monitoring conversational AI performance.

All analytics endpoints are scoped to a project and require the `analytics:read` permission.

| Scoped to: Project |
|---|

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/projects/:projectId/analytics/latency` | Get aggregated latency statistics |
| GET | `/api/projects/:projectId/analytics/latency/percentiles` | Get latency percentile distributions |
| GET | `/api/projects/:projectId/analytics/latency/trend` | Get latency trend over time |
| GET | `/api/projects/:projectId/analytics/conversations/:conversationId/timeline` | Get conversation timeline |

---

## Shared Query Parameters

The latency stats, latency percentiles, and latency trend endpoints accept the following query parameters for filtering:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `from` | `string` (ISO 8601) | No | Start of the date range (inclusive) |
| `to` | `string` (ISO 8601) | No | End of the date range (inclusive) |
| `stageId` | `string` | No | Filter by stage ID |
| `source` | `string` | No | Filter by input source: `text` or `voice` |

---

## Get Aggregated Latency Statistics

```
GET /api/projects/:projectId/analytics/latency
```

Returns aggregated latency statistics (avg, median, p95, min, max) for key turn-level metrics across conversations in the project.

### Query Parameters

See [Shared Query Parameters](#shared-query-parameters).

### Latency Metric

Each metric field in the response uses this structure:

| Field | Type | Description |
|-------|------|-------------|
| `count` | `integer` | Number of data points |
| `avg` | `number \| null` | Average value in milliseconds |
| `median` | `number \| null` | Median (p50) value in milliseconds |
| `p95` | `number \| null` | 95th percentile value in milliseconds |
| `min` | `number \| null` | Minimum value in milliseconds |
| `max` | `number \| null` | Maximum value in milliseconds |

### Response

| Field | Type | Description |
|-------|------|-------------|
| `totalTurns` | `integer` | Total number of turns matching the query |
| `totalTurnDurationMs` | `LatencyMetric` | Total turn duration from start to completion |
| `timeToFirstTokenMs` | `LatencyMetric` | Time from LLM call start to first token |
| `timeToFirstTokenFromTurnStartMs` | `LatencyMetric` | Time from turn start to first LLM token |
| `timeToFirstAudioMs` | `LatencyMetric` | Time from turn start to first audio chunk (voice only) |
| `llmDurationMs` | `LatencyMetric` | Total LLM call duration |
| `ttsDurationMs` | `LatencyMetric` | TTS synthesis duration (voice only) |
| `moderationDurationMs` | `LatencyMetric` | Content moderation API call duration |
| `processingDurationMs` | `LatencyMetric` | Classification and transformation processing duration |
| `actionsDurationMs` | `LatencyMetric` | Action execution duration |
| `asrDurationMs` | `LatencyMetric` | ASR recognition duration (voice only) |

::: tip
Voice-only metrics (`timeToFirstAudioMs`, `ttsDurationMs`, `asrDurationMs`) will be `null` for text-only turns.
:::

### Example

```bash
curl "http://localhost:3000/api/projects/my-project/analytics/latency?from=2025-01-01T00:00:00Z&to=2025-01-31T23:59:59Z&source=voice" \
  -H "Authorization: Bearer eyJhbG..."
```

```json
{
  "totalTurns": 1250,
  "totalTurnDurationMs": {
    "count": 1250, "avg": 2340.5, "median": 2100, "p95": 4500, "min": 800, "max": 8200
  },
  "timeToFirstTokenMs": {
    "count": 1250, "avg": 450.2, "median": 380, "p95": 1100, "min": 150, "max": 3200
  },
  "llmDurationMs": {
    "count": 1250, "avg": 1200.8, "median": 1050, "p95": 2800, "min": 300, "max": 5100
  },
  "ttsDurationMs": {
    "count": 1250, "avg": 380.1, "median": 320, "p95": 900, "min": 100, "max": 2000
  }
}
```

---

## Get Latency Percentile Distributions

```
GET /api/projects/:projectId/analytics/latency/percentiles
```

Returns percentile distributions (p50, p75, p90, p95, p99) for key turn-level duration metrics. Useful for understanding latency spread and tail performance.

### Query Parameters

See [Shared Query Parameters](#shared-query-parameters).

### Percentile Set

Each metric field in the response uses this structure:

| Field | Type | Description |
|-------|------|-------------|
| `p50` | `number \| null` | 50th percentile (median) in milliseconds |
| `p75` | `number \| null` | 75th percentile in milliseconds |
| `p90` | `number \| null` | 90th percentile in milliseconds |
| `p95` | `number \| null` | 95th percentile in milliseconds |
| `p99` | `number \| null` | 99th percentile in milliseconds |

### Response

| Field | Type | Description |
|-------|------|-------------|
| `totalTurns` | `integer` | Total number of turns matching the query |
| `totalTurnDurationMs` | `PercentileSet` | Total turn duration percentiles |
| `timeToFirstTokenMs` | `PercentileSet` | Time to first token percentiles |
| `timeToFirstTokenFromTurnStartMs` | `PercentileSet` | Time to first token from turn start percentiles |
| `timeToFirstAudioMs` | `PercentileSet` | Time to first audio percentiles (voice only) |
| `llmDurationMs` | `PercentileSet` | LLM duration percentiles |

### Example

```bash
curl "http://localhost:3000/api/projects/my-project/analytics/latency/percentiles?stageId=greeting" \
  -H "Authorization: Bearer eyJhbG..."
```

```json
{
  "totalTurns": 500,
  "totalTurnDurationMs": { "p50": 2100, "p75": 2800, "p90": 3500, "p95": 4500, "p99": 6200 },
  "timeToFirstTokenMs": { "p50": 380, "p75": 520, "p90": 750, "p95": 1100, "p99": 2000 },
  "llmDurationMs": { "p50": 1050, "p75": 1400, "p90": 2000, "p95": 2800, "p99": 4200 }
}
```

---

## Get Latency Trend Over Time

```
GET /api/projects/:projectId/analytics/latency/trend
```

Returns a time-series of average latency values bucketed by the specified interval. Useful for detecting latency regressions or improvements over time.

### Query Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `from` | `string` (ISO 8601) | No | — | Start of the date range (inclusive) |
| `to` | `string` (ISO 8601) | No | — | End of the date range (inclusive) |
| `stageId` | `string` | No | — | Filter by stage ID |
| `source` | `string` | No | — | Filter by input source: `text` or `voice` |
| `interval` | `string` | No | `day` | Time bucket interval: `hour`, `day`, or `week` |

### Response

| Field | Type | Description |
|-------|------|-------------|
| `interval` | `string` | Aggregation interval used |
| `points` | `LatencyTrendPoint[]` | Time-bucketed data points |

### Latency Trend Point

| Field | Type | Description |
|-------|------|-------------|
| `bucket` | `string` | Time bucket start (ISO 8601) |
| `turnCount` | `integer` | Number of turns in this bucket |
| `avgTotalTurnDurationMs` | `number \| null` | Average total turn duration |
| `avgTimeToFirstTokenMs` | `number \| null` | Average time to first token |
| `avgLlmDurationMs` | `number \| null` | Average LLM duration |
| `avgTimeToFirstAudioMs` | `number \| null` | Average time to first audio |

### Example

```bash
curl "http://localhost:3000/api/projects/my-project/analytics/latency/trend?from=2025-01-01&to=2025-01-07&interval=day" \
  -H "Authorization: Bearer eyJhbG..."
```

```json
{
  "interval": "day",
  "points": [
    {
      "bucket": "2025-01-01T00:00:00.000Z",
      "turnCount": 180,
      "avgTotalTurnDurationMs": 2340,
      "avgTimeToFirstTokenMs": 450,
      "avgLlmDurationMs": 1200,
      "avgTimeToFirstAudioMs": 800
    },
    {
      "bucket": "2025-01-02T00:00:00.000Z",
      "turnCount": 210,
      "avgTotalTurnDurationMs": 2180,
      "avgTimeToFirstTokenMs": 420,
      "avgLlmDurationMs": 1100,
      "avgTimeToFirstAudioMs": 760
    }
  ]
}
```

---

## Get Conversation Timeline

```
GET /api/projects/:projectId/analytics/conversations/:conversationId/timeline
```

Returns an ordered list of per-turn timing breakdowns for a specific conversation. Each turn combines user-side and assistant-side timing into a single row, useful for waterfall visualization.

### Route Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `projectId` | `string` | Project ID |
| `conversationId` | `string` | Conversation ID |

### Response

| Field | Type | Description |
|-------|------|-------------|
| `conversationId` | `string` | Conversation ID |
| `turns` | `ConversationTimelineTurn[]` | Ordered list of turns with timing breakdowns |

### Conversation Timeline Turn

| Field | Type | Description |
|-------|------|-------------|
| `turnIndex` | `integer` | 1-based sequential turn number |
| `timestamp` | `string` | Timestamp of the user message event (ISO 8601) |
| `source` | `string \| null` | Input source: `text` or `voice` |
| `asrDurationMs` | `number \| null` | ASR transcription duration |
| `moderationDurationMs` | `number \| null` | Content moderation duration |
| `processingDurationMs` | `number \| null` | Classification and transformation duration |
| `knowledgeRetrievalDurationMs` | `number \| null` | Knowledge base retrieval duration |
| `actionsDurationMs` | `number \| null` | Action execution duration |
| `fillerDurationMs` | `number \| null` | Filler sentence generation duration |
| `timeToFirstTokenMs` | `number \| null` | LLM start to first token |
| `timeToFirstTokenFromTurnStartMs` | `number \| null` | Turn start to first LLM token |
| `timeToFirstAudioMs` | `number \| null` | Turn start to first audio chunk |
| `llmDurationMs` | `number \| null` | Total LLM call duration |
| `ttsDurationMs` | `number \| null` | TTS synthesis duration |
| `totalTurnDurationMs` | `number \| null` | Total turn duration from start to completion |

### Example

```bash
curl "http://localhost:3000/api/projects/my-project/analytics/conversations/conv-123/timeline" \
  -H "Authorization: Bearer eyJhbG..."
```

```json
{
  "conversationId": "conv-123",
  "turns": [
    {
      "turnIndex": 1,
      "timestamp": "2025-01-15T10:00:01.000Z",
      "source": "voice",
      "asrDurationMs": 120,
      "moderationDurationMs": 45,
      "processingDurationMs": 350,
      "knowledgeRetrievalDurationMs": null,
      "actionsDurationMs": 80,
      "fillerDurationMs": null,
      "timeToFirstTokenMs": 420,
      "timeToFirstTokenFromTurnStartMs": 890,
      "timeToFirstAudioMs": 1100,
      "llmDurationMs": 1200,
      "ttsDurationMs": 380,
      "totalTurnDurationMs": 2340
    }
  ]
}
```
