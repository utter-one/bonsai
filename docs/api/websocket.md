# WebSocket API

The WebSocket API provides real-time bidirectional communication for conversational AI sessions.

For more information, see the [WebSocket Protocol](../guide/websocket) guide.

## Endpoint

```
ws://<host>:<port>/ws
```

## Protocol

Messages are exchanged as JSON objects. Each message has a `type` field that identifies the message kind.

**Client → Server** messages include a `requestId` for correlation with responses.

**Server → Client** responses echo the `requestId` and include a `success` boolean.

---

## Authentication

Authenticate immediately after connecting:

```json
{
  "requestId": "req-1",
  "type": "auth",
  "apiKey": "<your-api-key>",
  "sessionSettings": {
    "sendVoiceInput": true,
    "sendTextInput": true,
    "receiveVoiceOutput": true,
    "receiveTranscriptionUpdates": true,
    "receiveEvents": true
  }
}
```

### Auth Request

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `requestId` | `string` | Yes | Correlation ID |
| `type` | `"auth"` | Yes | Message type |
| `apiKey` | `string` | Yes | API key for authentication |
| `sessionSettings` | `object` | No | Client capabilities (see below) |

### Session Settings

All fields default to `true` if omitted.

| Field | Type | Description |
|-------|------|-------------|
| `sendVoiceInput` | `boolean` | Client can send voice input |
| `sendTextInput` | `boolean` | Client can send text input |
| `receiveVoiceOutput` | `boolean` | Client wants voice output |
| `receiveTranscriptionUpdates` | `boolean` | Client wants intermediate transcription updates |
| `receiveEvents` | `boolean` | Client wants conversation events |

### Auth Response

```json
{
  "type": "auth",
  "requestId": "req-1",
  "success": true,
  "sessionId": "session-abc",
  "projectSettings": {
    "projectId": "my-project",
    "acceptVoice": true,
    "generateVoice": true,
    "asrConfig": null
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `success` | `boolean` | Authentication result |
| `sessionId` | `string` | Auto-created session ID |
| `projectSettings` | `object` | Project settings (projectId, acceptVoice, generateVoice, asrConfig) |
| `error` | `string` | Error message (on failure) |

### Rate Limiting

Authentication attempts are rate-limited per IP address to prevent API key brute-forcing. If the limit is exceeded, the server sends an error response and immediately closes the connection:

```json
{
  "type": "auth",
  "requestId": "req-1",
  "success": false,
  "error": "Too many authentication attempts, please try again later"
}
```

The default limit is **10 attempts per 15 minutes** per IP. Configurable via `RATE_LIMIT_WS_AUTH_WINDOW_MS` and `RATE_LIMIT_WS_AUTH_MAX`.

---

## Session Lifecycle

### Start Conversation

```json
{
  "requestId": "req-2",
  "type": "start_conversation",
  "sessionId": "session-abc",
  "userId": "user-123",
  "stageId": "intro-stage",
  "agentId": "assistant"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sessionId` | `string` | Yes | Session ID from auth |
| `userId` | `string` | Yes | User initiating the conversation |
| `stageId` | `string` | No | Initial stage ID. Falls back to the project's `startingStageId` if omitted. If neither is set, the request fails. |
| `agentId` | `string` | No | Agent override |
| `timezone` | `string` | No | IANA timezone identifier (e.g. `America/New_York`). Highest precedence in: `start_conversation.timezone` → `userProfile.timezone` → `project.timezone` → UTC |

**Response**

| Field | Type | Description |
|-------|------|-------------|
| `success` | `boolean` | Whether creation succeeded |
| `conversationId` | `string` | Created conversation ID |
| `error` | `string` | Error on failure |

### Resume Conversation

```json
{
  "requestId": "req-3",
  "type": "resume_conversation",
  "sessionId": "session-abc",
  "conversationId": "conv-123"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sessionId` | `string` | Yes | Session ID |
| `conversationId` | `string` | Yes | Conversation to resume |

### End Conversation

```json
{
  "requestId": "req-4",
  "type": "end_conversation",
  "sessionId": "session-abc",
  "conversationId": "conv-123"
}
```

---

## User Input

### Send Text Input

```json
{
  "requestId": "req-5",
  "type": "send_user_text_input",
  "sessionId": "session-abc",
  "conversationId": "conv-123",
  "text": "Hello, how are you?"
}
```

**Response** includes `inputTurnId` for correlating subsequent events.

### Voice Input Flow

There are two voice input modes depending on whether the project has `asrConfig.serverVad` configured.

#### Standard Mode (client-managed turns)

Voice input uses a three-step flow:

**1. Start voice input:**

```json
{
  "requestId": "req-6",
  "type": "start_user_voice_input",
  "sessionId": "session-abc",
  "conversationId": "conv-123"
}
```

Response includes `inputTurnId`.

**2. Send voice chunks:**

```json
{
  "requestId": "req-7",
  "type": "send_user_voice_chunk",
  "sessionId": "session-abc",
  "conversationId": "conv-123",
  "inputTurnId": "turn-1",
  "audioData": "<base64-encoded-audio>",
  "ordinal": 0
}
```

| Field | Type | Description |
|-------|------|-------------|
| `audioData` | `string` | Base64-encoded audio chunk |
| `ordinal` | `integer` | Sequential chunk order |
| `inputTurnId` | `string` | Input turn ID from start |

**3. End voice input:**

```json
{
  "requestId": "req-8",
  "type": "end_user_voice_input",
  "sessionId": "session-abc",
  "conversationId": "conv-123",
  "inputTurnId": "turn-1"
}
```

#### Server-Side VAD Mode (server-managed turns)

When the project has `asrConfig.serverVad` configured, the server handles speech detection and turn lifecycle automatically. Three VAD algorithms are available: **legacy**, **silero**, and **firered**. See [Server VAD Config](./projects#server-vad-config) for algorithm details and parameters.

**How it works:**

1. After connecting and starting a conversation, the client streams audio continuously via `send_user_voice_chunk` — no `start_user_voice_input` or `end_user_voice_input` calls are needed.
2. When the server detects the start of speech, it generates a server-side `inputTurnId` and begins ASR recognition automatically.
3. When silence exceeds the configured threshold, the server finalises the utterance. If [Smart Turn Detection](./projects#smart-turn-detection) is enabled, the server runs ONNX inference on the buffered audio to verify the speaker has actually finished their turn before ending the utterance.
4. Once the AI response is complete and the conversation returns to `awaiting_user_input`, the VAD resets and is ready for the next utterance.

**Client flow in VAD mode:**

```json
{
  "requestId": "req-7",
  "type": "send_user_voice_chunk",
  "sessionId": "session-abc",
  "conversationId": "conv-123",
  "audioData": "<base64-encoded-audio>",
  "ordinal": 0
}
```

`inputTurnId` is **optional** in VAD mode — the server assigns it server-side and includes it in all downstream events (`user_transcribed_chunk`, `conversation_event`, etc.).

**Important notes:**

- The ASR input format must be PCM (`pcm_8000`, `pcm_16000`, `pcm_32000`, or `pcm_48000`) for server VAD to activate. If the ASR provider requires a non-PCM format, VAD is disabled and standard mode is used as a fallback.
- `start_user_voice_input` and `end_user_voice_input` are accepted but treated as no-ops in VAD mode.
- Audio sent while the conversation is in `awaiting_user_input` state (before speech is detected) is silently buffered by the VAD — no error is returned.
- Configuring `serverVad` automatically disables the need for clients to perform their own silence detection.

### User Transcription Updates (Server Push)

During voice input, the server may send intermediate transcription updates:

```json
{
  "type": "user_transcribed_chunk",
  "sessionId": "session-abc",
  "conversationId": "conv-123",
  "inputTurnId": "turn-1",
  "chunkId": "chunk-1",
  "chunkText": "Hello, how are",
  "ordinal": 0,
  "isFinal": false
}
```

### User Speaking Started (Server Push)

When server-side VAD detects the user speaking while the AI is generating a response (barge-in), the server pushes a `user_speaking_started` message. This signals the client that the AI's current turn is being interrupted.

```json
{
  "type": "user_speaking_started",
  "sessionId": "session-abc",
  "conversationId": "conv-123"
}
```

Upon receiving this message, the client should stop playing the AI's voice output and prepare for the new user utterance.

---

## AI Response (Server Push)

The server sends AI responses as a series of push messages:

### Generation Start

```json
{
  "type": "start_ai_generation_output",
  "sessionId": "session-abc",
  "conversationId": "conv-123",
  "outputTurnId": "out-1",
  "expectVoice": true
}
```

### AI Voice Chunks

```json
{
  "type": "send_ai_voice_chunk",
  "sessionId": "session-abc",
  "conversationId": "conv-123",
  "outputTurnId": "out-1",
  "audioData": "<base64-audio>",
  "audioFormat": "mp3",
  "chunkId": "chunk-1",
  "ordinal": 0,
  "isFinal": false,
  "sampleRate": 24000
}
```

| Field | Type | Description |
|-------|------|-------------|
| `audioData` | `string` | Base64-encoded audio |
| `audioFormat` | `string` | Audio format (see [Audio Formats](#audio-formats)) |
| `chunkId` | `string` | Unique chunk ID |
| `ordinal` | `integer` | Sequential chunk order |
| `isFinal` | `boolean` | Whether this is the final chunk |
| `sampleRate` | `integer` | Sample rate (e.g., 24000) |
| `bitRate` | `integer` | Bit rate in bps |

### AI Text Chunks

```json
{
  "type": "ai_transcribed_chunk",
  "sessionId": "session-abc",
  "conversationId": "conv-123",
  "outputTurnId": "out-1",
  "chunkId": "chunk-1",
  "chunkText": "Hello! I'm doing",
  "ordinal": 0,
  "isFinal": false
}
```

### AI Image Output

```json
{
  "type": "send_ai_image_output",
  "sessionId": "session-abc",
  "conversationId": "conv-123",
  "outputTurnId": "out-1",
  "imageData": "<base64-image>",
  "mimeType": "image/png",
  "sequenceNumber": 0
}
```

### AI Audio Output

```json
{
  "type": "send_ai_audio_output",
  "sessionId": "session-abc",
  "conversationId": "conv-123",
  "outputTurnId": "out-1",
  "audioData": "<base64-audio>",
  "audioFormat": "mp3",
  "mimeType": "audio/mpeg",
  "sequenceNumber": 0
}
```

### File Attachment Output

Delivered after text/voice output but before `end_ai_generation_output` when an action uses the `attach_file` effect:

```json
{
  "type": "attach_file_output",
  "sessionId": "session-abc",
  "conversationId": "conv-123",
  "outputTurnId": "out-1",
  "artifactId": "artifact-uuid",
  "fileName": "invoice.pdf",
  "mimeType": "application/pdf",
  "fileSize": 245678,
  "downloadUrl": "https://storage.example.com/signed-url?...expiry...&signature=...",
  "sequenceNumber": 0
}
```

| Field | Type | Description |
|-------|------|-------------|
| `artifactId` | `string` | ID of the conversation artifact record |
| `fileName` | `string` | Display name of the file |
| `mimeType` | `string` | MIME type of the file |
| `fileSize` | `integer` | File size in bytes |
| `downloadUrl` | `string` | URL to download the file (signed URL for external storage) |
| `sequenceNumber` | `integer` | 0-based index when multiple files are attached in a single response |
```

### Generation End

```json
{
  "type": "end_ai_generation_output",
  "sessionId": "session-abc",
  "conversationId": "conv-123",
  "outputTurnId": "out-1",
  "fullText": "Hello! I'm doing great, thank you for asking."
}
```

---

## Client Commands

### Go to Stage

Navigate to a different conversation stage.

```json
{
  "type": "go_to_stage",
  "sessionId": "session-abc",
  "conversationId": "conv-123",
  "stageId": "next-stage"
}
```

### Set Variable

```json
{
  "type": "set_var",
  "sessionId": "session-abc",
  "conversationId": "conv-123",
  "stageId": "current-stage",
  "variableName": "userName",
  "variableValue": "John Doe"
}
```

### Get Variable

```json
{
  "type": "get_var",
  "sessionId": "session-abc",
  "conversationId": "conv-123",
  "stageId": "current-stage",
  "variableName": "userName"
}
```

**Response** includes `variableName` and `variableValue`.

### Get All Variables

```json
{
  "type": "get_all_vars",
  "sessionId": "session-abc",
  "conversationId": "conv-123",
  "stageId": "current-stage"
}
```

**Response** includes `variables` (a `Record<string, ParameterValue>`).

### Run Action

Execute a global action by name.

```json
{
  "type": "run_action",
  "sessionId": "session-abc",
  "conversationId": "conv-123",
  "actionName": "submit_feedback",
  "parameters": {
    "rating": 5,
    "comment": "Great experience!"
  }
}
```

**Response** includes `result` (multi-modal content array) on success.

### Call Tool

Execute a tool by ID.

```json
{
  "type": "call_tool",
  "sessionId": "session-abc",
  "conversationId": "conv-123",
  "toolId": "summarizer",
  "parameters": {
    "text": "Long article content..."
  }
}
```

**Response** includes `result` (multi-modal content array) on success.

---

## Conversation Events (Server Push)

When `receiveEvents` is enabled, the server pushes conversation events:

```json
{
  "type": "conversation_event",
  "sessionId": "session-abc",
  "conversationId": "conv-123",
  "inputTurnId": "turn-1",
  "outputTurnId": "out-1",
  "eventType": "message",
  "eventData": {
    "eventType": "message",
    "role": "assistant",
    "text": "Hello! How can I help you?",
    "metadata": {}
  }
}
```

### Event Types

| Type | Description | Key Data Fields |
|------|-------------|-----------------|
| `message` | User/assistant message | `role`, `text`, `originalText` |
| `classification` | Intent classification | `classifierId`, `input`, `actions[]` |
| `transformation` | Context transformation | `transformerId`, `input`, `appliedFields[]` |
| `action` | Action triggered | `actionName`, `stageId`, `effects[]` |
| `command` | Client command | `command`, `parameters` |
| `tool_call` | Tool invocation | `toolId`, `toolName`, `toolType`, `parameters`, `success`, `result` |
| `conversation_start` | Conversation started | `stageId`, `initialVariables` |
| `conversation_resume` | Conversation resumed | `previousStatus`, `stageId` |
| `conversation_end` | Conversation ended | `reason`, `stageId` |
| `conversation_aborted` | Conversation aborted | `reason`, `stageId` |
| `conversation_failed` | Conversation failed | `reason`, `stageId` |
| `jump_to_stage` | Stage transition | `fromStageId`, `toStageId` |
| `execution_plan` | Planned actions before execution | `stageId`, `actions[]` |
| `moderation` | Content moderation decision | `action`, `reason` |
| `variables_updated` | Stage variables modified | `stageId`, `variables` |
| `user_profile_updated` | User profile fields changed | `profile` |
| `user_input_modified` | User input altered by middleware | `originalText`, `modifiedText` |
| `user_banned` | User banned during conversation | `reason` |
| `visibility_changed` | Conversation visibility toggled | `isVisible` |
| `sample_copy_selection` | Sample copy variant selected | `sampleCopyName`, `selection` |
| `turn_aborted` | Current AI turn aborted | `reason` |

The `eventData.metadata` object of `message`, `classification`, `transformation`, and `tool_call` events carries timing measurements. See [Event Metadata — Timing Fields](./conversations#event-metadata-timing-fields) for the full field reference.

---

## Audio Formats

Supported audio formats for voice chunks:

`mp3`, `opus`, `aac`, `flac`, `wav`, `pcm_8000`, `pcm_16000`, `pcm_22050`, `pcm_24000`, `pcm_44100`, `pcm_48000`, `mulaw`, `alaw`

## Parameter Value Types

Values in commands and parameters can be any of:

- `string`
- `number`
- `boolean`
- `object`
- `string[]`, `number[]`, `boolean[]`, `object[]`
- Image (`{ type: "image", data: "base64...", mimeType: "image/png" }`)
- Audio (`{ type: "audio", data: "base64...", mimeType: "audio/wav" }`)

## Full JSON Schema

The complete JSON Schema for all WebSocket message types is available at:

```
GET /websocket-contracts.json
```

This endpoint is unauthenticated.
