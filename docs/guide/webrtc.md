# WebRTC Channel

The WebRTC channel provides real-time bidirectional communication for live conversation sessions over WebRTC DataChannels. It offers lower audio latency than the WebSocket channel by eliminating base64 encoding and reducing round-trip overhead for audio packets.

## When to Use WebRTC vs WebSocket

| Consideration | WebSocket | WebRTC |
|---|---|---|
| Audio voice input/output | base64-encoded JSON | raw binary (no encoding overhead) |
| Control messages (auth, commands) | JSON over TCP | JSON over SCTP (same semantics) |
| Connection setup | Single HTTP upgrade | HTTP signaling + DTLS/SCTP handshake |
| Browser native audio | Manual encoding required | `MediaStream` captured directly |
| Network compatibility | Works everywhere | May fail with symmetric NAT (STUN only) |
| Audio latency | Good | Better |

Use **WebRTC** when audio latency matters — for example voice-first assistants where you are streaming microphone audio. Use **WebSocket** when you need maximum compatibility (corporate proxies, restrictive firewalls) or for text-only use cases.

Both channels are available simultaneously. The conversation protocol (message types, session lifecycle, commands) is identical between them.

## Architecture

Two RTCDataChannels are created by the client before the SDP offer is sent:

- **`control`** — ordered, reliable. Carries all JSON messages: auth, session lifecycle, user text input, commands, and server push events. Same protocol as WebSocket.
- **`audio`** — unordered, no retransmits. Carries binary audio frames for user voice input (client → server) and AI voice output (server → client). A dropped audio packet is silently discarded instead of retransmitting a stale chunk.

Audio frames on the `audio` DataChannel use a compact binary format:

```
[ 2 bytes: uint16 LE — turnId byte length ]
[ N bytes: turnId encoded as UTF-8        ]
[ remaining bytes: raw audio data          ]
```

All other messages (transcription updates, generation events, commands, errors) travel as JSON over the `control` channel — identical to WebSocket wire format.

## Signaling

WebRTC connection setup follows a gather-and-return model: the server collects all ICE candidates before returning the SDP answer, so the client receives a complete answer in a single HTTP response with no trickle ICE callbacks needed.

```
Client                              Server
  |                                   |
  |── POST /api/webrtc/offer ────────>|
  |   { sdpOffer: "..." }             |  creates RTCPeerConnection
  |                                   |  creates answer
  |                                   |  waits for ICE gathering
  |<─ 200 { sdpAnswer: "..." } ───────|
  |                                   |
  |═══ DTLS/SCTP handshake ══════════>|
  |                                   |
  |── control DataChannel open ─────>|  session registered
  |── audio DataChannel open ───────>|
  |                                   |
  |── auth (JSON, control) ─────────>|
  |<─ auth response (JSON, control) ──|
```

## Connection Setup

Create the two DataChannels, generate an SDP offer, exchange it with the server, then set the answer as the remote description.

```javascript
const pc = new RTCPeerConnection();

// Create DataChannels BEFORE generating the offer so they are
// included in the SDP and opened server-side via ondatachannel.
const controlChannel = pc.createDataChannel('control', {
  ordered: true,
});

const audioChannel = pc.createDataChannel('audio', {
  ordered: false,
  maxRetransmits: 0,
});

// Wait for both channels to open before authenticating
let controlOpen = false;
let audioOpen = false;

function onBothOpen() {
  // Authenticate immediately after both channels open
  controlChannel.send(JSON.stringify({
    requestId: 'req-1',
    type: 'auth',
    apiKey: 'your-project-api-key',
    sessionSettings: {
      sendVoiceInput: true,
      sendTextInput: true,
      receiveVoiceOutput: true,
      receiveTranscriptionUpdates: true,
      receiveEvents: true,
    },
  }));
}

controlChannel.onopen = () => { controlOpen = true; if (audioOpen) onBothOpen(); };
audioChannel.onopen  = () => { audioOpen  = true; if (controlOpen) onBothOpen(); };

controlChannel.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  handleControlMessage(msg);
};

audioChannel.onmessage = (event) => {
  // Binary audio frame from server (AI voice output)
  handleAudioFrame(event.data);
};

// Create offer and send to server
const offer = await pc.createOffer();
await pc.setLocalDescription(offer);

const response = await fetch('/api/webrtc/offer', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ sdpOffer: offer.sdp }),
});

const { sdpAnswer } = await response.json();
await pc.setRemoteDescription({ type: 'answer', sdp: sdpAnswer });
```

## Authentication

After both DataChannels open, send an `auth` message over the `control` channel. The format is identical to WebSocket:

```json
{
  "requestId": "req-1",
  "type": "auth",
  "apiKey": "your-project-api-key",
  "sessionSettings": {
    "sendVoiceInput": true,
    "sendTextInput": true,
    "receiveVoiceOutput": true,
    "receiveTranscriptionUpdates": true,
    "receiveEvents": true
  }
}
```

The server responds:

```json
{
  "type": "auth",
  "requestId": "req-1",
  "success": true,
  "sessionId": "session-uuid",
  "projectSettings": {
    "projectId": "my-project",
    "acceptVoice": true,
    "generateVoice": true,
    "asrConfig": null
  }
}
```

Save the `sessionId` — attach it to every subsequent message.

Authentication is rate-limited to **10 attempts per 15 minutes per IP** (same as WebSocket). Exceeding the limit closes the DataChannels.

## Session Settings

All fields default to `true` if omitted.

| Field | Description |
|---|---|
| `sendVoiceInput` | Client will send voice audio frames on the audio channel |
| `sendTextInput` | Client will send text input messages |
| `receiveVoiceOutput` | Server sends AI voice frames on the audio channel |
| `receiveTranscriptionUpdates` | Server sends interim transcription chunks over the control channel |
| `receiveEvents` | Server sends conversation event messages over the control channel |

## Conversation Lifecycle

All lifecycle messages are JSON sent over the `control` channel. The format is identical to WebSocket — only `sessionId` is included instead of it being derived from the WebSocket connection.

### Start Conversation

**Client → Server (control channel):**
```json
{
  "requestId": "req-2",
  "type": "start_conversation",
  "sessionId": "session-uuid",
  "userId": "user-123",
  "stageId": "greeting",
  "timezone": "Europe/Warsaw"
}
```

**Server → Client (control channel):**
```json
{
  "requestId": "req-2",
  "type": "start_conversation",
  "sessionId": "session-uuid",
  "conversationId": "conv-uuid",
  "success": true
}
```

### Resume Conversation

```json
{
  "requestId": "req-3",
  "type": "resume_conversation",
  "sessionId": "session-uuid",
  "conversationId": "conv-uuid"
}
```

### End Conversation

```json
{
  "requestId": "req-4",
  "type": "end_conversation",
  "sessionId": "session-uuid",
  "conversationId": "conv-uuid"
}
```

## User Input

### Text Input

Send over the `control` channel:

```json
{
  "requestId": "req-5",
  "type": "send_user_text_input",
  "sessionId": "session-uuid",
  "conversationId": "conv-uuid",
  "text": "Hello, I need help with my order"
}
```

### Voice Input

Voice input uses the `control` channel for signaling and the `audio` channel for binary audio data.

**1. Signal start (control channel):**

```json
{
  "requestId": "req-6",
  "type": "start_user_voice_input",
  "sessionId": "session-uuid",
  "conversationId": "conv-uuid"
}
```

The server responds with `inputTurnId`:

```json
{
  "requestId": "req-6",
  "type": "start_user_voice_input",
  "sessionId": "session-uuid",
  "success": true,
  "inputTurnId": "turn-uuid"
}
```

**2. Stream audio frames (audio channel):**

Encode each audio buffer as a binary frame and send it over the `audio` DataChannel:

```javascript
function encodeAudioFrame(turnId, audioBuffer) {
  const turnIdBytes = new TextEncoder().encode(turnId);
  const header = new ArrayBuffer(2);
  new DataView(header).setUint16(0, turnIdBytes.length, true); // little-endian
  return concatBuffers([header, turnIdBytes.buffer, audioBuffer]);
}

function concatBuffers(buffers) {
  const total = buffers.reduce((n, b) => n + b.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const buf of buffers) {
    out.set(new Uint8Array(buf), offset);
    offset += buf.byteLength;
  }
  return out.buffer;
}

// Called for each audio chunk from MediaRecorder or AudioWorklet
function onAudioChunk(audioBuffer, inputTurnId) {
  const frame = encodeAudioFrame(inputTurnId, audioBuffer);
  audioChannel.send(frame);
}
```

**3. Signal end (control channel):**

```json
{
  "requestId": "req-7",
  "type": "end_user_voice_input",
  "sessionId": "session-uuid",
  "conversationId": "conv-uuid",
  "inputTurnId": "turn-uuid"
}
```

### Transcription Updates (Server Push, control channel)

When `receiveTranscriptionUpdates` is enabled:

```json
{
  "type": "user_transcribed_chunk",
  "sessionId": "session-uuid",
  "conversationId": "conv-uuid",
  "inputTurnId": "turn-uuid",
  "chunkId": "chunk-uuid",
  "chunkText": "Hello, I need",
  "ordinal": 1,
  "isFinal": false
}
```

## AI Voice Output

AI voice chunks arrive as binary frames on the `audio` DataChannel using the same format as user voice input frames:

```
[ 2 bytes: uint16 LE — outputTurnId byte length ]
[ N bytes: outputTurnId as UTF-8                ]
[ remaining: raw audio data                      ]
```

Decode them on the client:

```javascript
audioChannel.onmessage = (event) => {
  const buffer = event.data instanceof ArrayBuffer
    ? event.data
    : event.data.arrayBuffer(); // Blob (some browsers)

  Promise.resolve(buffer).then((buf) => {
    const view = new DataView(buf);
    const turnIdLength = view.getUint16(0, true); // little-endian
    const turnId = new TextDecoder().decode(new Uint8Array(buf, 2, turnIdLength));
    const audioData = buf.slice(2 + turnIdLength);
    playAudioChunk(turnId, audioData);
  });
};
```

The control channel carries the surrounding generation events:

```json
{ "type": "start_ai_generation_output", "outputTurnId": "out-uuid", "expectVoice": true }
```
```json
{ "type": "ai_transcribed_chunk", "outputTurnId": "out-uuid", "chunkText": "Hello!", "ordinal": 1 }
```
```json
{ "type": "end_ai_generation_output", "outputTurnId": "out-uuid", "fullText": "Hello! ..." }
```

## Client Commands

All commands are JSON sent over the `control` channel. Formats are identical to WebSocket.

### Go to Stage

```json
{
  "requestId": "req-8",
  "type": "go_to_stage",
  "sessionId": "session-uuid",
  "conversationId": "conv-uuid",
  "stageId": "troubleshooting"
}
```

### Set / Get Variable

```json
{
  "requestId": "req-9",
  "type": "set_var",
  "sessionId": "session-uuid",
  "conversationId": "conv-uuid",
  "stageId": "current-stage",
  "variableName": "selectedProduct",
  "variableValue": "Widget Pro"
}
```

```json
{
  "requestId": "req-10",
  "type": "get_var",
  "sessionId": "session-uuid",
  "conversationId": "conv-uuid",
  "stageId": "current-stage",
  "variableName": "selectedProduct"
}
```

### Run Action / Call Tool

```json
{
  "requestId": "req-11",
  "type": "run_action",
  "sessionId": "session-uuid",
  "conversationId": "conv-uuid",
  "actionName": "check-order-status",
  "parameters": { "orderId": "ORD-123" }
}
```

```json
{
  "requestId": "req-12",
  "type": "call_tool",
  "sessionId": "session-uuid",
  "conversationId": "conv-uuid",
  "toolId": "translate",
  "parameters": { "text": "Hello", "language": "es" }
}
```

## Error Handling

Errors are sent as JSON over the `control` channel:

```json
{
  "type": "error",
  "requestId": "req-5",
  "error": "No active conversation in this session"
}
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `WEBRTC_ICE_GATHERING_TIMEOUT_MS` | `5000` | Maximum milliseconds to wait for ICE candidate gathering before returning the SDP answer |
| `WEBRTC_STUN_URL` | `stun:stun.l.google.com:19302` | STUN server URL used for ICE gathering |

## Connection Lifecycle Diagram

```mermaid
sequenceDiagram
    participant C as Client
    participant S as Server
    C->>S: POST /api/webrtc/offer
    S-->>C: 200 { sdpAnswer }
    Note over C,S: DTLS/SCTP handshake
    C->>S: control open
    Note over S: registerSession()
    C->>S: audio open
    C->>S: auth (control)
    S-->>C: auth success (control)
    C->>S: start_conversation (control)
    Note over S: attachConversationToSession()
    S-->>C: start_conversation result
    C->>S: start_user_voice_input (control)
    S-->>C: inputTurnId
    C->>S: binary audio frames (audio)
    Note over S: ASR provider
    S-->>C: user_transcribed_chunk (interim transcription)
    C->>S: end_user_voice_input (control)
    S-->>C: start_ai_generation_output
    S-->>C: ai_transcribed_chunk (text streaming)
    S-->>C: binary audio frames (TTS streaming)
    S-->>C: end_ai_generation_output
    C->>S: end_conversation (control)
    C->>S: control channel closes
    Note over S: unregisterSession()
```
