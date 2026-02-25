# Provider Catalog

The Provider Catalog API returns metadata about all available provider implementations. This is used to discover what provider types, API types, and configuration options are supported.

**Tag:** `Provider Catalog` | **Authentication:** None required

## Endpoints

| Method | Path | Summary |
|--------|------|---------|
| `GET` | `/api/provider-catalog` | Get complete provider catalog |
| `GET` | `/api/provider-catalog/asr` | Get ASR providers |
| `GET` | `/api/provider-catalog/tts` | Get TTS providers |
| `GET` | `/api/provider-catalog/llm` | Get LLM providers |
| `GET` | `/api/provider-catalog/storage` | Get storage providers |
| `GET` | `/api/provider-catalog/:type/:apiType` | Get specific provider info |

## Get Full Catalog

```http
GET /api/provider-catalog
```

Returns the complete catalog of all provider types.

**Response** `200 OK`

```json
{
  "asr": { "providers": [...] },
  "tts": { "providers": [...] },
  "llm": { "providers": [...] },
  "storage": { "providers": [...] }
}
```

## Get Providers by Type

```http
GET /api/provider-catalog/asr
GET /api/provider-catalog/tts
GET /api/provider-catalog/llm
GET /api/provider-catalog/storage
```

Returns providers for a specific category.

**Response** `200 OK`

```json
{
  "providers": [
    {
      "apiType": "openai",
      "name": "OpenAI",
      "description": "OpenAI API provider",
      "configSchema": { ... },
      "settingsSchema": { ... }
    }
  ]
}
```

## Get Specific Provider

```http
GET /api/provider-catalog/:type/:apiType
```

**Path Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `type` | `string` | Provider type: `asr`, `tts`, `llm`, or `storage` |
| `apiType` | `string` | Provider API type (e.g., `openai`, `azure`, `elevenlabs`) |

**Response** `200 OK` — Single provider info object

**Errors:** `404` Provider not found
