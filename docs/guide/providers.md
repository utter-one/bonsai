# Providers

**Providers** abstract external AI services used throughout the system. They are shared entities (not project-scoped) and can be referenced by multiple projects, stages, classifiers, transformers, and tools.

## Structure

| Field | Description |
|---|---|
| `id` | Unique identifier |
| `name` | Display name |
| `description` | Optional description |
| `providerType` | Service type: `llm`, `tts`, `asr`, `embeddings`, or `storage` |
| `apiType` | Implementation identifier (e.g., `openai`, `azure`, `anthropic`) |
| `config` | Provider-specific connection configuration |
| `createdBy` | Operator who created the provider |
| `tags` | Searchable labels for organization |
| `version` | Optimistic locking version |

## Provider Types

### LLM Providers

Used for: response generation (stages), classification (classifiers), data extraction (transformers), tool execution (tools).

| API Type | Description |
|---|---|
| `openai` | OpenAI Responses API (GPT-5, GPT-4o, o-series) |
| `openai-legacy` | OpenAI Chat Completions API (legacy) |
| `anthropic` | Anthropic API (Claude models) |
| `gemini` | Google Gemini API (also supports Vertex AI endpoints) |
| `groq` | Groq Cloud (fast inference, Llama / Mixtral models) |
| `mistral` | Mistral AI API |
| `deepseek` | DeepSeek API |
| `openrouter` | OpenRouter (unified gateway to many providers) |
| `together-ai` | Together AI |
| `fireworks-ai` | Fireworks AI |
| `perplexity` | Perplexity AI |
| `cohere` | Cohere API |
| `xai` | xAI (Grok models) |

**Configuration example (OpenAI):**

```json
{
  "apiKey": "sk-...",
  "organizationId": "org-...",
  "baseUrl": "https://api.openai.com/v1"
}
```

**LLM Settings** (per-reference, not in the provider config):

Each entity referencing an LLM provider can customize settings. Available fields depend on the provider's API type — see the Swagger UI for the full per-provider schema (e.g., `OpenAILlmSettings`, `AnthropicLlmSettings`). Common fields:

```json
{
  "model": "gpt-4o",
  "defaultMaxTokens": 2048,
  "defaultTemperature": 0.7,
  "defaultTopP": 1.0
}
```

> To discover which models are available for a configured provider, use `GET /api/providers/:id/models`.

### TTS Providers

Used for: voice synthesis in agents.

| API Type | Description |
|---|---|
| `elevenlabs` | ElevenLabs text-to-speech |
| `openai` | OpenAI TTS |
| `azure` | Azure Cognitive Services Speech |
| `deepgram` | Deepgram Aura TTS |
| `cartesia` | Cartesia Sonic TTS |

See [Agents](./agents) for TTS settings configuration per voice.

### ASR Providers

Used for: speech-to-text transcription at the project level.

| API Type | Description |
|---|---|
| `azure` | Azure Speech Services |
| `elevenlabs` | ElevenLabs speech recognition |
| `deepgram` | Deepgram Nova ASR |
| `assemblyai` | AssemblyAI Universal Streaming |
| `speechmatics` | Speechmatics real-time speech-to-text |

Configured in the project's `asrConfig`.

### Storage Providers

Used for: persisting conversation artifacts (audio recordings, transcripts).

| API Type | Description |
|---|---|
| `s3` | Amazon S3 or S3-compatible storage |
| `azure-blob` | Azure Blob Storage |
| `gcs` | Google Cloud Storage |
| `local` | Local filesystem storage |

Configured in the project's `storageConfig`.

## Provider Catalog

The system includes a built-in **Provider Catalog** that lists all available provider types, their API types, and configuration schemas. Access it via:

```
GET /api/provider-catalog
```

This is useful for building operator UIs that dynamically render provider configuration forms.

## Where Providers Are Referenced

| Entity | Provider Types Used |
|---|---|
| Project | ASR (speech-to-text), Storage (artifacts) |
| Agent | TTS (voice synthesis) |
| Stage | LLM (response generation) |
| Classifier | LLM (intent classification) |
| Context Transformer | LLM (variable population) |
| Tool | LLM (tool execution) |

## Provider Inheritance

If a stage, classifier, transformer, or tool does not specify its own `llmProviderId`, the system may fall back to project-level defaults. However, it's recommended to explicitly set providers for clarity and predictability.

## Security

Provider configurations contain sensitive data (API keys, connection strings). Only operators with `provider:read` or `provider:write` permissions can view or modify providers. The config is stored securely and not exposed in API responses beyond what's necessary.
