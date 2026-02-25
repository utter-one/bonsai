# Projects

A **Project** is the top-level container in Nexus Backend. It represents a complete conversational AI experience and contains all the entities needed to power conversations.

## Structure

Each project includes:

| Field | Description |
|---|---|
| `id` | Unique identifier |
| `name` | Display name |
| `description` | Optional description |
| `acceptVoice` | Whether the project accepts voice input from users |
| `generateVoice` | Whether the project generates voice output (TTS) |
| `asrConfig` | ASR (speech-to-text) provider configuration |
| `storageConfig` | Storage provider for conversation artifacts |
| `constants` | Key-value store for templating across all stages |
| `metadata` | Arbitrary JSON for custom data |
| `version` | Optimistic locking version number |

## ASR Configuration

The `asrConfig` object configures automatic speech recognition for the entire project:

```json
{
  "asrProviderId": "azure-speech-provider",
  "settings": { ... },
  "unintelligiblePlaceholder": "[unintelligible]",
  "voiceActivityDetection": true
}
```

- **`asrProviderId`** — References a registered ASR provider
- **`settings`** — Provider-specific settings (e.g., language, model)
- **`unintelligiblePlaceholder`** — Text inserted when speech cannot be transcribed
- **`voiceActivityDetection`** — Enables automatic detection of when the user starts/stops speaking

## Storage Configuration

The optional `storageConfig` allows persisting conversation artifacts (audio recordings, transcripts, images) to external storage:

```json
{
  "storageProviderId": "s3-storage",
  "settings": { ... }
}
```

## Constants

Project-level constants are available in all Handlebars prompts via <code v-pre>{{constants.key}}</code>. This is useful for values shared across stages, like company name, product info, or configuration values:

```json
{
  "companyName": "Acme Corp",
  "supportHours": "9am - 5pm EST",
  "maxRetries": 3
}
```

## Child Entities

A project contains the following child entities, all scoped by `projectId`:

- [Stages](./stages) — Conversation phases
- [Personas](./personas) — AI personality definitions
- [Classifiers](./classifiers) — Intent classification
- [Context Transformers](./context-transformers) — Data extraction
- [Tools](./tools) — Callable LLM-powered tools
- [Knowledge Categories & Items](./knowledge) — FAQ data
- [Global Actions](./global-actions) — Reusable action definitions
- [API Keys](./authentication#api-keys) — WebSocket authentication tokens
- Conversations — Recorded conversation sessions
- Users — End-user profiles

## Common Operations

Projects support the standard CRUD operations:

- **Create** — `POST /api/projects`
- **List** — `GET /api/projects` (with pagination, search, and filtering)
- **Get** — `GET /api/projects/:id`
- **Update** — `PUT /api/projects/:id` (requires `version` for optimistic locking)
- **Delete** — `DELETE /api/projects/:id` (requires `version`)
