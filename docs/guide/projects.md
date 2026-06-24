# Projects

A **Project** is the top-level container in Bonsai Backend. It represents a complete conversational AI experience and contains all the entities needed to power conversations.

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
| `moderationConfig` | Content moderation configuration (provider, blocked categories, execution mode) |
| `constants` | Key-value store for templating across all stages |
| `metadata` | Arbitrary JSON for custom data |
| `conversationTimeoutSeconds` | Inactivity timeout for active conversations (0 or null = disabled) |
| `autoCreateUsers` | Whether to automatically create user records on first conversation (default: `false`) |
| `defaultGuardrailClassifierId` | Optional default guardrail classifier applied project-wide |
| `timezone` | Default IANA timezone for the project (e.g. `America/New_York`) |
| `languageCode` | Optional ISO language code for the project (e.g. `en-US`, `pl-PL`). Exposed in conversation context as `project.languageCode` and `project.language`. |
| `startingStageId` | Optional default starting stage ID. Used as fallback when the client omits `stageId` in the `startConversation` WebSocket message. Set to `null` to clear. |
| `recordingConfig` | Audio recording configuration for conversation debugging |
| `userProfileVariableDescriptors` | Typed schema describing the fields expected on a user's profile |
| `version` | Optimistic locking version number |

## ASR Configuration

The `asrConfig` object configures automatic speech recognition for the entire project:

```json
{
  "asrProviderId": "azure-speech-provider",
  "settings": { ... },
  "unintelligiblePlaceholder": "[unintelligible]",
  "voiceActivityDetection": true,
  "serverVad": {
    "algorithm": "firered",
    "speechThreshold": 0.5,
    "smartTurn": {
      "enabled": true,
      "threshold": 0.5
    }
  }
}
```

- **`asrProviderId`** — References a registered ASR provider
- **`settings`** — Provider-specific settings (e.g., language, model)
- **`unintelligiblePlaceholder`** — Text inserted when speech cannot be transcribed
- **`voiceActivityDetection`** — Server VAD hint. When `true`, the client should be prepared for VAD before sending audio (cont. stream).
- **`serverVad`** — Server-side VAD configuration. When set, the server manages the turn lifecycle automatically — clients send continuous audio without calling `start_user_voice_input` or `end_user_voice_input`. Supports three algorithms:

  - **Legacy** (`algorithm: "legacy"`) — Original millisecond-based parameters with mode-based thresholds (0–3 aggressiveness)
  - **Silero** (`algorithm: "silero"`) — Frame-based parameters with fine-grained control over speech/silence thresholds
  - **FireRed** (`algorithm: "firered"`) — ONNX-based streaming VAD with state-of-the-art multilingual performance

  See [Server VAD Config](../api/projects#server-vad-config) for full parameter tables.

- **`serverVad.smartTurn`** — Optional post-VAD endpoint detection. Runs ONNX inference on buffered audio after VAD detects silence to verify the speaker has finished their turn, reducing false turn endings. See [Smart Turn Detection](../api/projects#smart-turn-detection).

## Storage Configuration

The optional `storageConfig` allows persisting conversation artifacts (audio recordings, transcripts, images) to external storage:

```json
{
  "storageProviderId": "s3-storage",
  "settings": { ... }
}
```

## Constants

Project-level constants are available in all Handlebars prompts and scripts via <code v-pre>{{consts.key}}</code>. This is useful for values shared across stages, like company name, product info, or configuration values:

```json
{
  "companyName": "Acme Corp",
  "supportHours": "9am - 5pm EST",
  "maxRetries": 3
}
```

## Conversation Timeout

The `conversationTimeoutSeconds` setting controls how long a conversation can remain inactive before it is automatically aborted.

- **`0` or `null` (default)** — Timeout is disabled; conversations remain active indefinitely.
- **Positive integer** — Conversations that have had no activity for this many seconds are automatically aborted with the reason `"Conversation timed out due to inactivity"`.
- **Negative values** — Rejected with a validation error.

A background job checks all active conversations every minute. Inactivity is measured from the timestamp of the **last conversation event** (falling back to `updatedAt` if no events have been recorded yet).

When a conversation is timed out:
1. Its status is set to `aborted`.
2. A `conversation_aborted` event is saved.
3. Any connected WebSocket clients receive a `conversation_aborted` event message.
4. The session is detached from the conversation.

```json
{
  "conversationTimeoutSeconds": 300
}
```

This example aborts any conversation that has been inactive for 5 minutes.

## Recording Configuration

The optional `recordingConfig` enables per-project audio recording of conversation sessions. When enabled, both user voice input and AI voice output are accumulated throughout the conversation and saved as separate audio files to the project's configured storage provider.

```json
{
  "recordingConfig": {
    "enabled": true,
    "recordInput": true,
    "recordOutput": true,
    "format": "pcm_16000"
  }
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | — | Whether recording is active for the project |
| `recordInput` | `boolean` | `true` | Record user voice input |
| `recordOutput` | `boolean` | `true` | Record AI voice output |
| `format` | `string` | `pcm_16000` | Target audio format for saved recordings |

Two separate files are produced per conversation: one for the user's voice (`user_voice`) and one for the AI's voice (`ai_voice`). This avoids format conflicts when input and output use different sample rates or encodings.

The source audio (which may be any format from the ASR/TTS providers) is automatically converted to the configured recording format. If the source format already matches the target, no conversion is performed.

Recordings are uploaded as conversation artifacts to the project's storage provider (S3, GCS, Azure Blob, or Local). If no storage provider is configured, recordings are skipped with a warning log.

## User Profile Variable Descriptors

The `userProfileVariableDescriptors` field defines the typed schema for profile data attached to users in this project. It mirrors the `variableDescriptors` concept used on stages, but applies to the user profile object.

Each descriptor specifies a field's name, type, and whether it is an array. Nested object schemas are supported recursively.

```json
{
  "userProfileVariableDescriptors": [
    { "name": "preferredLanguage", "type": "string", "isArray": false },
    { "name": "loyaltyTier", "type": "string", "isArray": false },
    { "name": "purchaseHistory", "type": "object", "isArray": true, "objectSchema": [
      { "name": "productId", "type": "string", "isArray": false },
      { "name": "amount", "type": "number", "isArray": false }
    ]}
  ]
}
```

This schema is used to validate and document the fields that stage effects of type `modify_user_profile` operate on. Keeping it accurate ensures consistent profile shape across all stages and agents in the project.

## Child Entities

A project contains the following child entities, all scoped by `projectId`:

- [Stages](./stages) — Conversation phases
- [Agents](./agents) — AI personality definitions
- [Classifiers](./classifiers) — Intent classification
- [Context Transformers](./context-transformers) — Variable population: data extraction, prompt fragments, flow control
- [Tools](./tools) — Callable LLM-powered tools
- [Knowledge Categories & Items](./knowledge) — FAQ data
- [Global Actions](./global-actions) — Reusable action definitions
- [Guardrails](../api/guardrails) — Content safety classifiers
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
