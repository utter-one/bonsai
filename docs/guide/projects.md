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
| `constants` | Key-value store for templating across all stages |
| `metadata` | Arbitrary JSON for custom data |
| `conversationTimeoutSeconds` | Inactivity timeout for active conversations (0 or null = disabled) |
| `userProfileVariableDescriptors` | Typed schema describing the fields expected on a user's profile |
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
