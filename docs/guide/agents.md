# Agents

An **Agent** defines the AI's personality and voice for a conversation stage. Agents are scoped to a project and can be shared across multiple stages.

## Structure

| Field | Description |
|---|---|
| `id` | Unique identifier (within project) |
| `projectId` | Parent project |
| `name` | Display name (e.g., "Friendly Agent", "Technical Support") |
| `description` | Optional description |
| `prompt` | Personality prompt appended to the stage's system prompt |
| `ttsProviderId` | TTS provider for voice synthesis |
| `ttsSettings` | Voice-specific settings (depends on TTS provider) |
| `fillerSettings` | Optional LLM-generated filler sentence spoken at the start of each turn |
| `metadata` | Arbitrary JSON |
| `tags` | Searchable labels for organization |
| `archived` | Whether the agent is archived |
| `version` | Optimistic locking version |

## Personality Prompt

The agent's `prompt` defines behavioral characteristics that are combined with the stage's system prompt. This allows reusing the same personality across different stages while varying the task-specific instructions.

Example:

```
You speak in a warm, professional tone. You use simple language and avoid
technical jargon. You always confirm understanding before moving forward.
When the user seems frustrated, you acknowledge their feelings first.
```

## Voice Configuration

The `ttsSettings` object varies by TTS provider:

### ElevenLabs

```json
{
  "provider": "elevenlabs",
  "voiceId": "voice-id",
  "modelId": "eleven_multilingual_v2",
  "stability": 0.5,
  "similarityBoost": 0.75,
  "style": 0.0,
  "useSpeakerBoost": true,
  "outputFormat": "mp3_44100_128"
}
```

### OpenAI

```json
{
  "provider": "openai",
  "voice": "alloy",
  "model": "tts-1",
  "speed": 1.0,
  "responseFormat": "mp3"
}
```

### Azure

```json
{
  "provider": "azure",
  "voiceName": "en-US-JennyNeural",
  "outputFormat": "audio-16khz-32kbitrate-mono-mp3"
}
```

### Deepgram

```json
{
  "provider": "deepgram",
  "model": "aura-asteria-en"
}
```

### Cartesia

```json
{
  "provider": "cartesia",
  "voiceId": "voice-id",
  "modelId": "sonic-2",
  "language": "en",
  "outputFormat": "raw_pcm_f32le_44100"
}
```

## Filler Responses

Filler responses reduce perceived latency by playing a short LLM-generated sentence through TTS at the very start of each response turn — before classification has finished and while the main AI reply is still being generated.

### How it works

1. The user finishes speaking (or sends a text message).
2. The system immediately calls the filler LLM provider with the configured `prompt` and the user's input.
3. The generated sentence (e.g. *"Hmm, let me think about that."*) is sent to TTS and streamed to the client while classification runs in parallel.
4. When the main AI response is ready, it continues from where the filler sentence left off — the filler text is passed as an assistant prefill so the LLM produces a naturally flowing continuation.
5. If no main response is needed (e.g. the conversation ends), the filler turn is cleanly closed.

### Configuration

Set `fillerSettings` on the agent:

```json
{
  "llmProviderId": "provider-id",
  "llmSettings": {
    "model": "gpt-4o-mini",
    "temperature": 0.7
  },
  "prompt": "Generate a single short neutral sentence to fill silence while processing. Examples: \"Hmm, let me think about that.\", \"Sure, one moment.\", \"Let me check that for you.\". Output only the sentence, no quotes."
}
```

Remove filler responses by setting `fillerSettings` to `null` in an update request.

### Available template variables

The `prompt` supports [Handlebars templates](./templating). The following variables are available at filler-generation time (note that `actions`, `results`, and FAQ are **not** available since classification has not run yet):

| Variable | Description |
|----------|-------------|
| `{{ userInput }}` | The raw text of the current user turn |
| `{{ vars }}` | Stage-scoped conversation variables |
| `{{ stageVars }}` | All stage variables keyed by stage ID |
| `{{ userProfile }}` | User profile object |
| `{{ consts }}` | Project-level constants |
| `{{ history }}` | Conversation message history |
| `{{ time }}` | Current time context |
| `{{ stage }}` | Current stage context |

### Tips

- Keep the filler prompt strict: instruct the LLM to produce **one sentence only**, with no extra commentary or punctuation.
- Use a fast, cheap LLM (e.g. `gpt-4o-mini`) since latency here directly affects when the user first hears audio.
- You can reference `{{ userInput }}` in the prompt to make fillers slightly context-aware (e.g. different fillers for questions vs statements).

## Usage in Stages

Every stage must reference exactly one agent via `agentId`. The agent's prompt is combined with the stage prompt when generating responses, and the agent's TTS settings determine the voice used for audio output.

Multiple stages can share the same agent, which is useful when you want consistent voice and personality across different conversation phases.

## Cloning

Agents can be cloned to create variations (e.g., same voice with a different personality prompt, or same personality with a different voice).
