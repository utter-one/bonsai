# WebSocket Communication Guide

## Overview

This guide provides comprehensive documentation for client developers to integrate with the Nexus Backend WebSocket API. The WebSocket server enables real-time, bidirectional communication for managing conversational AI interactions, including voice input/output, text messaging, and conversation state management.

## � JSON Schema Reference

All WebSocket message contracts are available as **JSON Schema** for validation and code generation in any programming language.

### Accessing the Schema

**HTTP Endpoint:** `GET /websocket-contracts.json`
- Unauthenticated endpoint serving the complete schema
- Returns all message type definitions in JSON Schema format
- Same content as the file below

**File:** [`schemas/websocket-contracts.json`](../schemas/websocket-contracts.json)
- Contains all 34+ message type definitions in one file
- Each message type is available under the `definitions` property
- Use this for client library generation, validation, or documentation
- JSON Schema Draft 2020-12 format

### Generating the Schema

To regenerate the schema after contract changes:
```bash
npm run schemas:generate
```

This exports all Zod schemas from [`src/websocket/contracts/`](../src/websocket/contracts/) to JSON Schema format using Zod 4.x's built-in `.toJSONSchema()` method.

### Usage Example

Reference a specific message type:
```json
{
  "$ref": "websocket-contracts.json#/definitions/auth-request"
}
```

## �🔌 Connection Details

### WebSocket Endpoint
```
ws://[host]/ws
wss://[host]/ws  (for secure connections)
```

### Connection Lifecycle
1. **Connect** - Establish WebSocket connection
2. **Authenticate** - Send authentication message with API key
3. **Session Created** - Server responds with session ID
4. **Start/Resume Conversation** - Begin or continue a conversation
5. **Exchange Messages** - Send user input, receive AI responses
6. **End Conversation** - Gracefully close the conversation
7. **Disconnect** - Close WebSocket connection

## 🔐 Authentication

### Initial Authentication
Authentication is **required** before using most WebSocket features. Only the `auth` message type does not require authentication.

**Request:**
```json
{
  "type": "auth",
  "requestId": "unique-request-id",
  "apiKey": "your-api-key-here"
}
```

**Success Response:**
```json
{
  "type": "auth",
  "requestId": "unique-request-id",
  "success": true,
  "sessionId": "session_abc123xyz",
  "projectSettings": {
    "projectId": "project_123",
    "acceptVoice": true,
    "generateVoice": true,
    "asrConfig": {
      "asrProviderId": "azure-speech",
      "settings": {
        "language": "en-US",
        "dictionaryPhrases": ["Nexus", "Utter"],
        "audioFormat": "pcm_16000"
      }
    }
  }
}
```

**Error Response:**
```json
{
  "type": "auth",
  "requestId": "unique-request-id",
  "success": false,
  "error": "Invalid API key"
}
```

### API Key Configuration
Ensure you have a valid API key before attempting to connect. API keys are managed through the Admin API:
- Each API key is tied to a specific project
- Keys can be created via `POST /api/api-keys` 
- Keys can be activated/deactivated via `PUT /api/api-keys/:id`
- Keys are stored securely in the database
- The full secret key is only shown once at creation time

## 📨 Message Format

### Base Message Structure

All messages follow a consistent structure:

**Client-to-Server (Input Messages):**
```typescript
{
  "type": string,              // Message type discriminator
  "requestId": string,         // Unique identifier for request correlation
  "sessionId": string,         // Session ID (for authenticated messages)
  // ... type-specific fields
}
```

**Server-to-Client (Output Messages):**
```typescript
{
  "type": string,              // Message type discriminator
  "requestId"?: string,        // Optional request ID for correlation
  "sessionId"?: string,        // Session ID (for session-based messages)
  // ... type-specific fields
}
```

### Request IDs
- **Purpose**: Correlate responses with requests in async communication
- **Format**: Any unique string (UUID recommended)
- **Best Practice**: Generate a unique ID for each request and track it in your client

### Error Messages
When an error occurs, the server sends:
```json
{
  "type": "error",
  "error": "Error description",
  "requestId": "original-request-id"
}
```

## 💬 Conversation Management

### Starting a New Conversation

**Request:**
```json
{
  "type": "start_conversation",
  "requestId": "req-001",
  "sessionId": "session_abc123xyz",
  "userId": "user-123",
  "stageId": "stage-456",
  "personaId": "persona-789"  // Optional
}
```

**Response:**
```json
{
  "type": "start_conversation",
  "requestId": "req-001",
  "sessionId": "session_abc123xyz",
  "success": true,
  "conversationId": "conv-xyz789"
}
```

**Notes:**
- One conversation per session at a time
- Attempting to start a conversation while one is active will result in an error
- The conversation automatically begins after successful creation

### Resuming an Existing Conversation

**Request:**
```json
{
  "type": "resume_conversation",
  "requestId": "req-002",
  "sessionId": "session_abc123xyz",
  "conversationId": "conv-xyz789"
}
```

**Response:**
```json
{
  "type": "resume_conversation",
  "requestId": "req-002",
  "sessionId": "session_abc123xyz",
  "success": true,
  "conversationId": "conv-xyz789"
}
```

### Ending a Conversation

**Request:**
```json
{
  "type": "end_conversation",
  "requestId": "req-003",
  "sessionId": "session_abc123xyz",
  "conversationId": "conv-xyz789"
}
```

**Response:**
```json
{
  "type": "end_conversation",
  "requestId": "req-003",
  "sessionId": "session_abc123xyz",
  "success": true
}
```

## 🎤 Voice Input (User → AI)

Voice input follows a three-phase process: start, stream chunks, end.

### Phase 1: Start Voice Input

**Request:**
```json
{
  "type": "start_user_voice_input",
  "requestId": "req-voice-001",
  "sessionId": "session_abc123xyz",
  "conversationId": "conv-xyz789"
}
```

**Response:**
```json
{
  "type": "start_user_voice_input",
  "requestId": "req-voice-001",
  "sessionId": "session_abc123xyz",
  "success": true
}
```

### Phase 2: Send Voice Chunks

Stream audio data in chunks as the user speaks:

**Request:**
```json
{
  "type": "send_user_voice_chunk",
  "requestId": "req-voice-chunk-001",
  "sessionId": "session_abc123xyz",
  "conversationId": "conv-xyz789",
  "audioData": "base64-encoded-audio-data..."
}
```

**Response:**
```json
{
  "type": "send_user_voice_chunk",
  "requestId": "req-voice-chunk-001",
  "sessionId": "session_abc123xyz",
  "success": true
}
```

**Audio Format Requirements:**
- Encoding: Base64
- Recommended chunk size: 1-5 seconds of audio
- Format is agreed before sending audio (use `projectSettings.asrConfig.settings.audioFormat` from the auth response)
- If `asrConfig` or `audioFormat` is missing, use the server default (currently `pcm_16000`)

### Phase 3: End Voice Input

Signal that the user has finished speaking:

**Request:**
```json
{
  "type": "end_user_voice_input",
  "requestId": "req-voice-end-001",
  "sessionId": "session_abc123xyz",
  "conversationId": "conv-xyz789"
}
```

**Response:**
```json
{
  "type": "end_user_voice_input",
  "requestId": "req-voice-end-001",
  "sessionId": "session_abc123xyz",
  "success": true
}
```

After ending voice input, the server processes the audio, transcribes it, and generates an AI response.

## 💬 Text Input (User → AI)

For text-based input, use a single message:

**Request:**
```json
{
  "type": "send_user_text_input",
  "requestId": "req-text-001",
  "sessionId": "session_abc123xyz",
  "conversationId": "conv-xyz789",
  "text": "Hello, how are you?"
}
```

**Response:**
```json
{
  "type": "send_user_text_input",
  "requestId": "req-text-001",
  "sessionId": "session_abc123xyz",
  "success": true
}
```

After receiving text input, the AI processes it and generates a response.

## 🔊 Voice Output (AI → User)

The AI response is delivered as streaming voice output with three phases: start, chunks, end.

### Phase 1: Start AI Voice Output

**Server Message:**
```json
{
  "type": "start_ai_voice_output",
  "sessionId": "session_abc123xyz",
  "conversationId": "conv-xyz789",
  "outputTurnId": "voice-out-001"
}
```

The `outputTurnId` identifies this specific voice output sequence.

### Phase 2: Receive Voice Chunks

**Server Message:**
```json
{
  "type": "send_ai_voice_chunk",
  "sessionId": "session_abc123xyz",
  "conversationId": "conv-xyz789",
  "outputTurnId": "voice-out-001",
  "audioData": "base64-encoded-audio-data...",
  "audioFormat": "pcm_16000",
  "chunkId": "chunk-001",
  "ordinal": 0,
  "isFinal": false
}
```

**Fields:**
- `audioData`: Base64-encoded audio chunk
- `chunkId`: Unique identifier for this chunk
- `ordinal`: Sequential order (0, 1, 2, ...)
- `isFinal`: `true` for the last chunk, `false` otherwise

**Client Implementation:**
- Buffer or immediately play chunks based on `ordinal`
- Use `isFinal` to detect when the output is complete
- Correlate chunks using `outputTurnId`

### Phase 3: End AI Voice Output

**Server Message:**
```json
{
  "type": "end_ai_voice_output",
  "sessionId": "session_abc123xyz",
  "conversationId": "conv-xyz789",
  "outputTurnId": "voice-out-001"
}
```

Signals that all audio chunks have been sent.

## 🎮 Conversation Control Commands

These commands allow dynamic control over conversation flow and state.

### Navigate to a Stage

Change the current stage in the conversation:

**Request:**
```json
{
  "type": "go_to_stage",
  "requestId": "req-stage-001",
  "sessionId": "session_abc123xyz",
  "conversationId": "conv-xyz789",
  "stageId": "stage-new-123"
}
```

**Response:**
```json
{
  "type": "go_to_stage",
  "requestId": "req-stage-001",
  "sessionId": "session_abc123xyz",
  "success": true
}
```

### Set a Variable

Set a variable value in a specific stage:

**Request:**
```json
{
  "type": "set_var",
  "requestId": "req-var-set-001",
  "sessionId": "session_abc123xyz",
  "conversationId": "conv-xyz789",
  "stageId": "stage-456",
  "variableName": "userName",
  "variableValue": "John Doe"
}
```

**Response:**
```json
{
  "type": "set_var",
  "requestId": "req-var-set-001",
  "sessionId": "session_abc123xyz",
  "success": true
}
```

**Notes:**
- `variableValue` can be any JSON-serializable type (string, number, boolean, object, array)

### Get a Variable

Retrieve a variable value from a specific stage:

**Request:**
```json
{
  "type": "get_var",
  "requestId": "req-var-get-001",
  "sessionId": "session_abc123xyz",
  "conversationId": "conv-xyz789",
  "stageId": "stage-456",
  "variableName": "userName"
}
```

**Response:**
```json
{
  "type": "get_var",
  "requestId": "req-var-get-001",
  "sessionId": "session_abc123xyz",
  "success": true,
  "variableName": "userName",
  "variableValue": "John Doe"
}
```

### Get All Variables

Retrieve all variables from a specific stage:

**Request:**
```json
{
  "type": "get_all_vars",
  "requestId": "req-all-vars-001",
  "sessionId": "session_abc123xyz",
  "conversationId": "conv-xyz789",
  "stageId": "stage-456"
}
```

**Response:**
```json
{
  "type": "get_all_vars",
  "requestId": "req-all-vars-001",
  "sessionId": "session_abc123xyz",
  "success": true,
  "variables": {
    "userName": "John Doe",
    "userAge": 30,
    "preferences": {
      "theme": "dark",
      "notifications": true
    }
  }
}
```

### Run a Global Action

Execute a global action with parameters:

**Request:**
```json
{
  "type": "run_action",
  "requestId": "req-action-001",
  "sessionId": "session_abc123xyz",
  "conversationId": "conv-xyz789",
  "actionName": "sendEmail",
  "parameters": ["user@example.com", "Hello!", "Message body"]
}
```

**Response:**
```json
{
  "type": "run_action",
  "requestId": "req-action-001",
  "sessionId": "session_abc123xyz",
  "success": true,
  "result": {
    "emailId": "email-123",
    "status": "sent"
  }
}
```

**Notes:**
- `parameters` is an array that gets passed to the action handler
- `result` contains the return value from the action execution

## 📋 Complete Message Type Reference

### Authentication
- `auth` (no auth required)

### Session Management  
- `start_conversation` (requires auth)
- `resume_conversation` (requires auth)
- `end_conversation` (requires auth)

### User Input
- `start_user_voice_input` (requires auth)
- `send_user_voice_chunk` (requires auth)
- `end_user_voice_input` (requires auth)
- `send_user_text_input` (requires auth)

### AI Output (Server → Client)
- `start_ai_voice_output`
- `send_ai_voice_chunk`
- `end_ai_voice_output`

### Conversation Control
- `go_to_stage` (requires auth)
- `set_var` (requires auth)
- `get_var` (requires auth)
- `get_all_vars` (requires auth)
- `run_action` (requires auth)

### Error Handling
- `error` (sent by server when errors occur)

## 🔄 Typical Conversation Flow

### Example: Voice-Based Conversation

```
1. Client → Server: auth
2. Server → Client: auth (success, sessionId)
3. Client → Server: start_conversation
4. Server → Client: start_conversation (success, conversationId)
5. Client → Server: start_user_voice_input
6. Server → Client: start_user_voice_input (success)
7. Client → Server: send_user_voice_chunk (multiple times)
8. Server → Client: send_user_voice_chunk (success, multiple)
9. Client → Server: end_user_voice_input
10. Server → Client: end_user_voice_input (success)
11. Server → Client: start_ai_voice_output
12. Server → Client: send_ai_voice_chunk (multiple times)
13. Server → Client: end_ai_voice_output
14. ... repeat steps 5-13 for conversation turns ...
15. Client → Server: end_conversation
16. Server → Client: end_conversation (success)
17. Client disconnects WebSocket
```

### Example: Text-Based Conversation

```
1. Client → Server: auth
2. Server → Client: auth (success, sessionId)
3. Client → Server: start_conversation
4. Server → Client: start_conversation (success, conversationId)
5. Client → Server: send_user_text_input
6. Server → Client: send_user_text_input (success)
7. Server → Client: start_ai_voice_output
8. Server → Client: send_ai_voice_chunk (multiple times)
9. Server → Client: end_ai_voice_output
10. ... repeat steps 5-9 for conversation turns ...
11. Client → Server: end_conversation
12. Server → Client: end_conversation (success)
13. Client disconnects WebSocket
```

## 🛠️ Client Implementation Guide

### JavaScript/TypeScript Example

```typescript
class NexusWebSocketClient {
  private ws: WebSocket;
  private sessionId: string | null = null;
  private conversationId: string | null = null;
  private requestHandlers: Map<string, (response: any) => void> = new Map();

  constructor(private url: string, private apiKey: string) {}

  // Connect and authenticate
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = async () => {
        console.log('WebSocket connected');
        await this.authenticate();
        resolve();
      };

      this.ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        this.handleMessage(message);
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        reject(error);
      };

      this.ws.onclose = () => {
        console.log('WebSocket disconnected');
      };
    });
  }

  // Authenticate with API key
  private async authenticate(): Promise<void> {
    const requestId = this.generateRequestId();
    
    return new Promise((resolve, reject) => {
      this.requestHandlers.set(requestId, (response) => {
        if (response.success) {
          this.sessionId = response.sessionId;
          console.log('Authenticated, session ID:', this.sessionId);
          resolve();
        } else {
          reject(new Error(response.error));
        }
      });

      this.send({
        type: 'auth',
        requestId,
        apiKey: this.apiKey,
      });
    });
  }

  // Start a new conversation
  async startConversation(userId: string, stageId: string, personaId?: string): Promise<string> {
    const requestId = this.generateRequestId();
    
    return new Promise((resolve, reject) => {
      this.requestHandlers.set(requestId, (response) => {
        if (response.success) {
          this.conversationId = response.conversationId;
          resolve(response.conversationId);
        } else {
          reject(new Error(response.error));
        }
      });

      this.send({
        type: 'start_conversation',
        requestId,
        sessionId: this.sessionId,
        userId,
        stageId,
        personaId,
      });
    });
  }

  // Send text input
  async sendTextInput(text: string): Promise<void> {
    const requestId = this.generateRequestId();
    
    return new Promise((resolve, reject) => {
      this.requestHandlers.set(requestId, (response) => {
        if (response.success) {
          resolve();
        } else {
          reject(new Error(response.error));
        }
      });

      this.send({
        type: 'send_user_text_input',
        requestId,
        sessionId: this.sessionId,
        conversationId: this.conversationId,
        text,
      });
    });
  }

  // Voice input - start
  async startVoiceInput(): Promise<void> {
    const requestId = this.generateRequestId();
    
    return new Promise((resolve, reject) => {
      this.requestHandlers.set(requestId, (response) => {
        if (response.success) {
          resolve();
        } else {
          reject(new Error(response.error));
        }
      });

      this.send({
        type: 'start_user_voice_input',
        requestId,
        sessionId: this.sessionId,
        conversationId: this.conversationId,
      });
    });
  }

  // Voice input - send chunk
  async sendVoiceChunk(audioData: string): Promise<void> {
    const requestId = this.generateRequestId();
    
    return new Promise((resolve, reject) => {
      this.requestHandlers.set(requestId, (response) => {
        if (response.success) {
          resolve();
        } else {
          reject(new Error(response.error));
        }
      });

      this.send({
        type: 'send_user_voice_chunk',
        requestId,
        sessionId: this.sessionId,
        conversationId: this.conversationId,
        audioData,
      });
    });
  }

  // Voice input - end
  async endVoiceInput(): Promise<void> {
    const requestId = this.generateRequestId();
    
    return new Promise((resolve, reject) => {
      this.requestHandlers.set(requestId, (response) => {
        if (response.success) {
          resolve();
        } else {
          reject(new Error(response.error));
        }
      });

      this.send({
        type: 'end_user_voice_input',
        requestId,
        sessionId: this.sessionId,
        conversationId: this.conversationId,
      });
    });
  }

  // End conversation
  async endConversation(): Promise<void> {
    const requestId = this.generateRequestId();
    
    return new Promise((resolve, reject) => {
      this.requestHandlers.set(requestId, (response) => {
        if (response.success) {
          this.conversationId = null;
          resolve();
        } else {
          reject(new Error(response.error));
        }
      });

      this.send({
        type: 'end_conversation',
        requestId,
        sessionId: this.sessionId,
        conversationId: this.conversationId,
      });
    });
  }

  // Handle incoming messages
  private handleMessage(message: any): void {
    console.log('Received message:', message.type);

    // Handle responses to requests
    if (message.requestId && this.requestHandlers.has(message.requestId)) {
      const handler = this.requestHandlers.get(message.requestId);
      handler(message);
      this.requestHandlers.delete(message.requestId);
      return;
    }

    // Handle server-initiated messages
    switch (message.type) {
      case 'start_ai_voice_output':
        this.onAiVoiceStart(message);
        break;
      case 'send_ai_voice_chunk':
        this.onAiVoiceChunk(message);
        break;
      case 'end_ai_voice_output':
        this.onAiVoiceEnd(message);
        break;
      case 'error':
        this.onError(message);
        break;
      default:
        console.warn('Unhandled message type:', message.type);
    }
  }

  // Override these methods in your implementation
  protected onAiVoiceStart(message: any): void {
    console.log('AI voice output started:', message.outputTurnId);
  }

  protected onAiVoiceChunk(message: any): void {
    console.log('AI voice chunk received:', message.chunkId, 'ordinal:', message.ordinal, 'format:', message.audioFormat);
    // Decode base64 audioData and play/buffer it
  }

  protected onAiVoiceEnd(message: any): void {
    console.log('AI voice output ended:', message.outputTurnId);
  }

  protected onError(message: any): void {
    console.error('Server error:', message.error);
  }

  // Helper methods
  private send(message: any): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      throw new Error('WebSocket is not connected');
    }
  }

  private generateRequestId(): string {
    return `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
    }
  }
}

// Usage example
async function main() {
  const client = new NexusWebSocketClient('ws://localhost:3000/ws', 'your-api-key');
  
  try {
    await client.connect();
    
    const conversationId = await client.startConversation('user-123', 'stage-456');
    console.log('Conversation started:', conversationId);
    
    await client.sendTextInput('Hello, how are you?');
    console.log('Text input sent');
    
    // Wait for AI response...
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    await client.endConversation();
    console.log('Conversation ended');
    
    client.disconnect();
  } catch (error) {
    console.error('Error:', error);
  }
}
```

## ⚠️ Error Handling Best Practices

1. **Request Timeouts**: Implement timeouts for all requests
2. **Reconnection Logic**: Handle disconnections and implement automatic reconnection
3. **Message Queueing**: Queue messages when disconnected and resend on reconnection
4. **Validation**: Validate all incoming messages before processing
5. **Logging**: Log all messages for debugging purposes
6. **Error Recovery**: Implement graceful degradation for partial failures

## 🔍 Debugging Tips

1. **Enable Verbose Logging**: Log all sent and received messages
2. **Request ID Tracking**: Use meaningful request IDs to trace message flows
3. **Connection State**: Track and log WebSocket connection state changes
4. **Message Ordering**: Verify message ordering, especially for voice chunks
5. **Buffer Management**: Monitor audio buffer sizes and playback state
6. **Network Monitoring**: Use browser DevTools or network analyzers to inspect WebSocket traffic

## 📊 Performance Considerations

1. **Chunk Size**: Balance between latency and overhead when sending audio chunks
2. **Message Batching**: Avoid sending too many messages in quick succession
3. **Buffer Management**: Implement efficient audio buffering to prevent gaps in playback
4. **Memory Management**: Clean up message handlers and buffers when no longer needed
5. **Connection Pooling**: Reuse connections when possible instead of frequent reconnects

## 🔒 Security Considerations

1. **API Key Protection**: Never expose API keys in client-side code (use environment variables or secure storage)
2. **API Key Management**: API keys are stored in the database and can be managed through the Admin API
3. **Project Isolation**: Each API key is scoped to a specific project, providing natural isolation
4. **Key Rotation**: Disable old keys and create new ones regularly for enhanced security
5. **Secure WebSocket**: Use `wss://` in production environments
6. **Input Validation**: Validate all user input before sending to the server
7. **Rate Limiting**: Implement client-side rate limiting to prevent abuse
8. **Session Management**: Properly clean up sessions and conversations on disconnect

## 📝 Additional Resources

- **TypeScript Types**: All message types are defined in `/src/websocket/contracts/`
- **Server Implementation**: See `/src/websocket/` for server-side code
- **Authentication**: See `/docs/AUTHENTICATION.md` for REST API authentication

## 🆘 Common Issues

### Authentication Failed
- Verify API key is correct and active
- Check that the API key exists in the database via `GET /api/api-keys`
- Ensure the API key is associated with a valid project
- Ensure you're sending the `auth` message first

### Session Not Found
- Authenticate before sending any session-based messages
- Store the `sessionId` from the auth response
- Include `sessionId` in all subsequent messages

### Conversation Already Active
- End the current conversation before starting a new one
- Or resume the existing conversation instead

### Invalid Message Type
- Verify the `type` field matches exactly (case-sensitive)
- Check that all required fields are included
- Ensure JSON is valid

### Audio Playback Issues
- Verify audio format matches server expectations
- Check Base64 encoding/decoding
- Ensure chunks are played in order using `ordinal`
- Buffer chunks if needed for smooth playback

---

**Version:** 1.0  
**Last Updated:** February 5, 2026  
**Maintained By:** Nexus Backend Team
