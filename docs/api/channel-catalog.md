# Channel Catalog

The channel catalog provides a list of all communication channel types supported by the backend instance, along with their capabilities. This endpoint is unauthenticated and not scoped to a project.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/channel-catalog` | List all supported channels |
| GET | `/api/channel-catalog/:type` | Get a single channel by type |

---

## List All Channels

```
GET /api/channel-catalog
```

Returns all communication channel types supported by this backend instance, including their capabilities and supported audio formats.

### Response

| Field | Type | Description |
|-------|------|-------------|
| `channels` | `ChannelInfo[]` | List of all supported channels |

### Channel Info

| Field | Type | Description |
|-------|------|-------------|
| `type` | `string` | Unique channel type identifier (e.g. `websocket`, `webrtc`, `twilio_voice`) |
| `name` | `string` | Human-friendly channel name (e.g. `WebSocket`, `WebRTC`, `Twilio Voice`) |
| `capabilities` | `ChannelCapabilities` | Capabilities supported by this channel |

### Channel Capabilities

| Field | Type | Description |
|-------|------|-------------|
| `supportsVoiceInput` | `boolean` | Whether the channel supports receiving audio from the user |
| `supportsTextInput` | `boolean` | Whether the channel supports receiving text messages from the user |
| `supportsVoiceOutput` | `boolean` | Whether the channel supports sending audio to the user |
| `supportsTextOutput` | `boolean` | Whether the channel supports sending text messages to the user |
| `supportsCommands` | `boolean` | Whether the channel supports client-sent commands (e.g. go-to-stage, set-var) |
| `supportsEvents` | `boolean` | Whether the channel supports server-sent event notifications |
| `supportsIncomingConnections` | `boolean` | Whether the channel can accept user-initiated sessions |
| `supportsOutgoingConnections` | `boolean` | Whether the channel can initiate sessions to users |
| `supportedAudioFormats` | `string[]` (optional) | Audio formats accepted by this channel for voice input/output |

### Example

```bash
curl "http://localhost:3000/api/channel-catalog"
```

```json
{
  "channels": [
    {
      "type": "websocket",
      "name": "WebSocket",
      "capabilities": {
        "supportsVoiceInput": true,
        "supportsTextInput": true,
        "supportsVoiceOutput": true,
        "supportsTextOutput": true,
        "supportsCommands": true,
        "supportsEvents": true,
        "supportsIncomingConnections": true,
        "supportsOutgoingConnections": false,
        "supportedAudioFormats": ["pcm_16000", "pcm_48000", "opus", "g711_ulaw"]
      }
    },
    {
      "type": "webrtc",
      "name": "WebRTC",
      "capabilities": {
        "supportsVoiceInput": true,
        "supportsTextInput": false,
        "supportsVoiceOutput": true,
        "supportsTextOutput": false,
        "supportsCommands": true,
        "supportsEvents": true,
        "supportsIncomingConnections": true,
        "supportsOutgoingConnections": false,
        "supportedAudioFormats": ["opus"]
      }
    }
  ]
}
```

---

## Get Channel by Type

```
GET /api/channel-catalog/:type
```

Returns a single channel by its type identifier.

### Response

`ChannelInfo` object (see above)

**Errors:** `404` Channel type not found
