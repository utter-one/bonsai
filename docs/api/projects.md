# Projects

Projects are the top-level organizational unit. All conversation resources (stages, agents, classifiers, etc.) belong to a project.

**Tag:** `Projects`

For more information, see the [Projects](../guide/projects) guide and [Core Concepts](../guide/concepts).

## Create Project

```http
POST /api/projects
Content-Type: application/json
```

**Required permission:** `project:write`

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` (min 1, max 255) | Yes | Project name |
| `description` | `string` | No | Project description |
| `asrConfig` | [`AsrConfig`](#asr-config) | No | ASR configuration settings |
| `acceptVoice` | `boolean` | No (default: `true`) | Whether conversations accept voice input |
| `generateVoice` | `boolean` | No (default: `true`) | Whether conversations generate voice responses |
| `storageConfig` | [`StorageConfig`](#storage-config) | No | Storage configuration for conversation artifacts |
| `moderationConfig` | [`ModerationConfig`](#moderation-config) | No | Content moderation configuration |
| `constants` | `Record<string, ParameterValue>` | No | Constants for templating and conversation logic |
| `metadata` | `object` | No | Additional metadata |
| `timezone` | `string` | No | IANA timezone identifier for conversations (e.g. `Europe/Warsaw`). Used as fallback when no per-user or per-conversation timezone is set. Defaults to UTC. |
| `languageCode` | `string` | No | ISO language code for conversations (e.g. `en-US`, `pl-PL`). Exposed in conversation context as `project.languageCode` and `project.language`. |
| `userProfileVariableDescriptors` | [`FieldDescriptor[]`](#field-descriptor) | No (default: `[]`) | Descriptors defining the data schema for user profile variables in this project |
| `conversationTimeoutSeconds` | `integer` (min: 0) | No | Inactivity timeout in seconds. Active conversations with no new events for this duration are automatically aborted. Set to `0` or omit to disable. Negative values are rejected. |
| `autoCreateUsers` | `boolean` | No (default: `false`) | When enabled, users are automatically created on first WebSocket connection if they do not exist |
| `defaultGuardrailClassifierId` | `string` | No | ID of the classifier used to evaluate guardrails for all conversations in this project |
| `recordingConfig` | `RecordingConfig` | No | Audio recording configuration for conversation debugging |
| `sampleCopyConfig` | [`SampleCopyConfig`](#sample-copy-config) | No | Sample copy configuration including the default classifier for prompt triggers |
| `startingStageId` | `string` | No | ID of the stage to start new conversations at when no `stageId` is provided at conversation start time. Acts as the project-level default starting stage. |
| `costManagementConfig` | [`CostManagementConfig`](#cost-management-config) | No | Project-level LLM token cost management configuration |
| `recordingConfig` | [`RecordingConfig`](#recording-config) | No | Audio recording configuration for conversation debugging |

**Response** `201 Created` — [Project Response](#project-response)

**Errors:** `400` Invalid body | `409` Project already exists

## Get Project

```http
GET /api/projects/:id
```

**Required permission:** `project:read`

**Response** `200 OK` — [Project Response](#project-response)

**Errors:** `404` Not found

## List Projects

```http
GET /api/projects
```

**Required permission:** `project:read`

Supports [pagination & filtering](./pagination).

**Response** `200 OK`

```json
{
  "items": [ProjectResponse],
  "total": 5
}
```

## Update Project

```http
PUT /api/projects/:id
Content-Type: application/json
```

**Required permission:** `project:write`

All fields from the create body are optional. `version` is required for optimistic locking.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | `integer` | Yes | Current version for optimistic locking |
| `name` | `string` | No | Updated name |
| `description` | `string` | No | Updated description |
| `asrConfig` | [`AsrConfig`](#asr-config) | No | Updated ASR config |
| `acceptVoice` | `boolean` | No | Updated voice acceptance |
| `generateVoice` | `boolean` | No | Updated voice generation |
| `storageConfig` | [`StorageConfig`](#storage-config) | No | Updated storage config |
| `moderationConfig` | [`ModerationConfig`](#moderation-config) | No | Updated moderation config |
| `constants` | `Record<string, ParameterValue>` | No | Updated constants |
| `metadata` | `object` | No | Updated metadata |
| `timezone` | `string` or `null` | No | Updated IANA timezone identifier. Set to `null` to clear. |
| `languageCode` | `string` or `null` | No | Updated ISO language code. Set to `null` to clear. |
| `userProfileVariableDescriptors` | [`FieldDescriptor[]`](#field-descriptor) | No | Updated descriptors for user profile variable schema |
| `conversationTimeoutSeconds` | `integer` (min: 0) or `null` | No | Updated inactivity timeout in seconds. Set to `0` or `null` to disable. |
| `autoCreateUsers` | `boolean` | No | Updated auto-create users setting |
| `defaultGuardrailClassifierId` | `string` or `null` | No | Updated guardrail classifier ID. Set to `null` to disable. |
| `startingStageId` | `string` or `null` | No | Updated default starting stage ID. Set to `null` to remove. |
| `sampleCopyConfig` | [`SampleCopyConfig`](#sample-copy-config) or `null` | No | Updated sample copy configuration. Set to `null` to clear. |
| `costManagementConfig` | [`CostManagementConfig`](#cost-management-config) or `null` | No | Updated cost management configuration. Set to `null` to remove. |
| `recordingConfig` | [`RecordingConfig`](#recording-config) or `null` | No | Updated recording configuration. Set to `null` to disable. |

**Response** `200 OK` — [Project Response](#project-response)

**Errors:** `400` Invalid body | `404` Not found | `409` Version conflict

## Delete Project

```http
DELETE /api/projects/:id
```

**Required permission:** `project:delete`

**Response** `204 No Content`

**Errors:** `404` Not found

---

## Project Response

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `id` | `string` | No | Unique identifier |
| `name` | `string` | No | Project name |
| `description` | `string` | Yes | Description |
| `asrConfig` | `AsrConfig` | Yes | ASR configuration |
| `acceptVoice` | `boolean` | No | Whether voice input is accepted |
| `generateVoice` | `boolean` | No | Whether voice is generated |
| `storageConfig` | `StorageConfig` | Yes | Storage configuration |
| `moderationConfig` | `ModerationConfig` | Yes | Content moderation configuration |
| `constants` | `Record<string, ParameterValue>` | Yes | Project constants |
| `metadata` | `object` | Yes | Additional metadata |
| `timezone` | `string` | Yes | IANA timezone identifier (null means UTC) |
| `languageCode` | `string` | Yes | ISO language code (e.g. `en-US`, `pl-PL`), or `null` if not set |
| `userProfileVariableDescriptors` | [`FieldDescriptor[]`](#field-descriptor) | No | Descriptors defining the data schema for user profile variables |
| `conversationTimeoutSeconds` | `integer` | Yes | Inactivity timeout in seconds. `null` or `0` means no timeout. |
| `autoCreateUsers` | `boolean` | No | Whether users are auto-created on first WebSocket connection |
| `defaultGuardrailClassifierId` | `string` | Yes | Classifier ID for evaluating guardrails |
| `startingStageId` | `string` | Yes | Default starting stage ID. `null` means no project-level default is set. |
| `sampleCopyConfig` | [`SampleCopyConfig`](#sample-copy-config) | Yes | Sample copy configuration. `null` means not configured. |
| `costManagementConfig` | [`CostManagementConfig`](#cost-management-config) | Yes | LLM token cost management configuration. `null` means not configured. |
| `recordingConfig` | [`RecordingConfig`](#recording-config) | Yes | Audio recording configuration. `null` means recording is not configured. |
| `version` | `integer` | No | Version number |
| `createdAt` | `string` | No | ISO 8601 creation timestamp |
| `updatedAt` | `string` | No | ISO 8601 last update timestamp |
| `archivedAt` | `string` | Yes | ISO 8601 timestamp when the project was archived |
| `archivedBy` | `string` | Yes | ID of the operator who archived the project |

## ASR Config

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `asrProviderId` | `string` | No | ASR provider ID |
| `settings` | `object` | No | ASR-specific settings (varies by provider: Azure, ElevenLabs, Deepgram) |
| `unintelligiblePlaceholder` | `string` | No | Placeholder text for unintelligible speech |
| `voiceActivityDetection` | `boolean` | No | Whether to enable voice activity detection to automatically start/stop recording based on speech presence |
| `silenceTimeoutMs` | `integer` (min: 0) | No | Milliseconds of user silence before triggering an AI response. Set to 0 or omit to disable. |
| `maxSilences` | `integer` (min: 0) | No | Maximum number of consecutive silence responses before ending the conversation. Set to 0 or omit for unlimited. |
| `silencePlaceholder` | `string` or `null` | No | Text fed to the AI as user input when silence is detected. The stage prompt can reference this text to generate an appropriate response. |
| `serverVad` | [`ServerVadConfig`](#server-vad-config) | No | Server-side VAD configuration. When set, the server manages the turn lifecycle automatically — see [Server-Side VAD](#server-vad-config). |

## Server VAD Config

When `serverVad` is present in `asrConfig`, the server continuously monitors incoming audio for speech and manages the ASR turn lifecycle autonomously. Clients do not need to call `start_user_voice_input` or `end_user_voice_input` — they simply send audio via `send_user_voice_chunk` and let the server detect utterance boundaries.

The `algorithm` field determines which VAD configuration variant is used. Existing configurations without `algorithm` are automatically treated as `legacy`.

### Legacy Algorithm (`algorithm: "legacy"`)

Millisecond-based parameters with mode-based threshold selection. This is the original configuration format.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `algorithm` | `"legacy"` | Yes | Selects the legacy VAD algorithm |
| `mode` | `integer` (0–3) | No | VAD aggressiveness. Higher values reduce false positives at the cost of cutting off soft speech. Default: `2`. |
| `frameDurationMs` | `10` \| `20` \| `30` | No | Duration of each VAD analysis frame in milliseconds. Default: `20`. |
| `silencePaddingMs` | `integer` (0–1000) | No | Milliseconds of audio to include before the detected speech start (pre-roll). Default: `300`. |
| `autoEndSilenceDurationMs` | `integer` (100–5000) | No | Milliseconds of silence after speech that triggers end-of-utterance detection. Default: `800`. |
| `gracePeriodMs` | `integer` (0–5000) | No | Milliseconds after VAD initialization during which `speech_start` is suppressed. Prevents false positives from phone connection noise. Default: `1000`. |

### Silero Algorithm (`algorithm: "silero"`)

Frame-based parameters that map directly to the underlying Silero VAD processor settings. This provides fine-grained control over all VAD behavior.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `algorithm` | `"silero"` | Yes | Selects the Silero VAD algorithm |
| `model` | `"v5"` \| `"legacy"` | No | Silero VAD model version. Default: `v5`. |
| `positiveSpeechThreshold` | `number` (0–1) | No | Probability threshold above which a frame is considered speech. Default: `0.5`. |
| `negativeSpeechThreshold` | `number` (0–1) | No | Probability threshold below which a frame is considered silence. Default: `0.35`. |
| `frameSamples` | `integer` | No | Number of audio samples per VAD frame. Silero was trained on 512, 1024, 1536 samples at 16kHz. Default: `1536`. |
| `redemptionFrames` | `integer` | No | Number of silent frames after speech before end-of-utterance is triggered. Default: `8`. |
| `preSpeechPadFrames` | `integer` | No | Number of frames of pre-roll silence prepended to the audio segment on speech start. Default: `1`. |
| `minSpeechFrames` | `integer` | No | Minimum frames required to consider a segment as speech. Default: `3`. |
| `submitUserSpeechOnPause` | `boolean` | No | Whether to submit partial speech when VAD is paused. Default: library default. |
| `gracePeriodMs` | `integer` (0–5000) | No | Milliseconds after VAD initialization during which `speech_start` is suppressed. Default: `1000`. |

### FireRed Algorithm (`algorithm: "firered"`)

ONNX-based VAD using FireRedTeam's streaming model with packed-cache inference. Provides state-of-the-art multilingual VAD performance with a state-machine-based postprocessor.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `algorithm` | `"firered"` | Yes | Selects the FireRedVAD algorithm |
| `speechThreshold` | `number` (0–1) | No | Probability threshold above which a smoothed frame is classified as speech. Default: `0.5`. |
| `smoothWindowSize` | `integer` | No | Size of the moving-average smoothing window applied to raw frame probabilities. Default: `5`. |
| `minSpeechFrame` | `integer` | No | Minimum consecutive speech frames required before `speech_start` is emitted. Default: `8`. |
| `maxSpeechFrame` | `integer` | No | Maximum consecutive speech frames before a forced `speech_end` (long-utterance cutoff). Default: `2000`. |
| `minSilenceFrame` | `integer` | No | Minimum consecutive silence frames after speech before `speech_end` is emitted. Default: `20`. |
| `padStartFrame` | `integer` | No | Number of frames of pre-roll audio prepended to the detected speech start. Default: `5`. |
| `gracePeriodMs` | `integer` (0–5000) | No | Milliseconds after VAD initialization during which `speech_start` is suppressed. Default: `1000`. |

### Smart Turn Detection

Optional post-VAD endpoint detection that runs ONNX inference on the full utterance audio after VAD detects silence. This reduces false turn endings by verifying whether the speaker has actually finished their turn or is pausing mid-sentence.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `smartTurn.enabled` | `boolean` | No | Enable Smart Turn endpoint detection. Default: `false`. |
| `smartTurn.threshold` | `number` (0–1) | No | Probability threshold for endpoint classification. Values above this threshold are considered turn endings. Default: `0.5`. |

Smart Turn can be combined with any VAD algorithm. When enabled, after VAD detects silence, the server runs ONNX inference on the buffered audio using Whisper-style mel-filterbank features. If the model determines the speaker is still talking (probability below threshold), the VAD continues listening instead of ending the utterance.

## Storage Config

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `storageProviderId` | `string` | No | Storage provider ID |
| `settings` | `object` | No | Storage-specific settings (varies by provider: S3, Azure Blob, GCS, Local) |

## Field Descriptor

Describes a single field in a typed schema. Used in `userProfileVariableDescriptors` to define the expected shape of a user's profile data, enabling validation and tooling.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Field name |
| `type` | `string` | Yes | One of: `string`, `number`, `boolean`, `object`, `string[]`, `number[]`, `boolean[]`, `object[]`, `image`, `image[]`, `audio`, `audio[]` |
| `isArray` | `boolean` | Yes | Whether the field holds an array of values |
| `objectSchema` | `FieldDescriptor[]` | No | Nested field descriptors when `type` is `object` or `object[]` |

## Moderation Config

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `enabled` | `boolean` | Yes | Whether content moderation is enabled for this project |
| `llmProviderId` | `string` | Yes | ID of the LLM provider used for moderation (must support moderation API, e.g. OpenAI or Mistral) |
| `blockedCategories` | `string[]` | No | List of category names that should cause the input to be blocked. If omitted or empty, any flagged category will block the input. Category names are provider-specific. |
| `mode` | `string` | No | Execution mode: `strict` (default) or `standard`. In `strict` mode, moderation runs before any other processing. In `standard` mode, moderation runs in parallel with classification after filler generation, reducing latency. See [Content Moderation](../guide/moderation#moderation-mode). |

## Recording Config

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `enabled` | `boolean` | Yes | Whether audio recording is enabled for this project |
| `recordInput` | `boolean` | No (default: `true`) | Whether to record user voice input |
| `recordOutput` | `boolean` | No (default: `true`) | Whether to record AI voice output |
| `format` | `string` | No (default: `pcm_16000`) | Audio format for saved recordings (e.g. `pcm_16000`, `pcm_48000`, `g711_ulaw`, `opus`) |

When enabled, two separate audio files are produced per conversation: `user_voice` and `ai_voice`. Source audio is automatically converted to the configured recording format. Recordings are uploaded as conversation artifacts to the project's configured storage provider.

## Sample Copy Config

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `defaultClassifierId` | `string` | No | ID of the classifier used to evaluate sample copy prompt triggers for all stages in this project. Individual sample copies can override this with `classifierOverrideId`. |

## Cost Management Config

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `llmProviderId` | `string` | Yes | ID of the LLM provider whose cost rates to use |
| `monthlyBudgetUsd` | `number` (positive) | No | Monthly budget limit in USD. When exceeded, LLM calls will fail with a budget error. |
| `perConversationBudgetUsd` | `number` (positive) | No | Per-conversation budget limit in USD. When exceeded, the conversation will fail with a budget error. |

## Get Audit Logs

```http
GET /api/projects/:id/audit-logs
```

**Required permission:** `audit:read`

Returns audit log entries for the specified project. See [Audit Logs](./audit-logs) for response format.

## Archive Project

```http
POST /api/projects/:id/archive
Content-Type: application/json
```

**Required permission:** `project:write`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | `integer` | Yes | Current version for optimistic locking |

**Response** `200 OK` — [Project Response](#project-response)

**Errors:** `404` Not found | `409` Version conflict or already archived

## Unarchive Project

```http
POST /api/projects/:id/unarchive
Content-Type: application/json
```

**Required permission:** `project:write`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | `integer` | Yes | Current version for optimistic locking |

**Response** `200 OK` — [Project Response](#project-response)

**Errors:** `400` Project is not archived | `404` Not found | `409` Version conflict
