# Personas

A **Persona** defines the AI's personality and voice for a conversation stage. Personas are scoped to a project and can be shared across multiple stages.

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
| `metadata` | Arbitrary JSON |
| `version` | Optimistic locking version |

## Personality Prompt

The persona's `prompt` defines behavioral characteristics that are combined with the stage's system prompt. This allows reusing the same personality across different stages while varying the task-specific instructions.

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

## Usage in Stages

Every stage must reference exactly one persona via `personaId`. The persona's prompt is combined with the stage prompt when generating responses, and the persona's TTS settings determine the voice used for audio output.

Multiple stages can share the same persona, which is useful when you want consistent voice and personality across different conversation phases.

## Cloning

Personas can be cloned to create variations (e.g., same voice with a different personality prompt, or same personality with a different voice).
