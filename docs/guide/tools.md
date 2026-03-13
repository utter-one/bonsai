# Tools

A **Tool** is an LLM-powered callable operation within a project. Tools are invoked via the `call_tool` effect in actions, or directly by clients through WebSocket commands. They process input, call an LLM with a specialized prompt, and return results.

## Structure

| Field | Description |
|---|---|
| `id` | Unique identifier (within project) |
| `projectId` | Parent project |
| `name` | Display name |
| `description` | Optional description |
| `prompt` | Tool execution prompt (Handlebars template) |
| `llmProviderId` | LLM provider for tool execution |
| `llmSettings` | LLM-specific settings |
| `inputType` | Input modality: `text`, `image`, or `multi-modal` |
| `outputType` | Output modality: `text`, `image`, or `multi-modal` |
| `parameters` | Array of tool parameter definitions |
| `metadata` | Arbitrary JSON |
| `tags` | Searchable labels for organization |
| `archived` | Whether the tool is archived |
| `version` | Optimistic locking version |

## Tool Parameters

Tools define their input schema via `parameters`:

```json
[
  {
    "name": "text",
    "type": "string",
    "description": "The text to analyze",
    "required": true
  },
  {
    "name": "language",
    "type": "string",
    "description": "Target language code",
    "required": false
  }
]
```

Supported parameter types: `string`, `number`, `boolean`, `object`, `string[]`, `number[]`, `boolean[]`, `object[]`, `image`, `image[]`, `audio`, `audio[]`.

## Multimodal Parameters

Tools support multimodal inputs and outputs:

**Image parameter:**
```json
{
  "data": "<base64-encoded image>",
  "mimeType": "image/png",
  "metadata": { "width": 800, "height": 600 }
}
```

**Audio parameter:**
```json
{
  "data": "<base64-encoded audio>",
  "format": "wav",
  "mimeType": "audio/wav",
  "metadata": { "sampleRate": 44100, "channels": 1 }
}
```

## Using Tools in Actions

Tools are invoked through the `call_tool` effect in stage actions:

```json
{
  "type": "call_tool",
  "toolId": "translate-text",
  "parameters": {
    "text": "{{userInput}}",
    "language": "{{vars.targetLanguage}}"
  }
}
```

The tool's result is stored in the execution context and accessible by subsequent effects and prompts.

## Using Tools via WebSocket

Client applications can also invoke tools directly through the `call_tool` WebSocket command, passing the tool ID and parameters. This is useful for tools that the client application triggers explicitly rather than through conversation flow.

## Use Cases

- **Translation** — Translate user messages or responses
- **Summarization** — Condense conversation history
- **Data lookup** — Query information using LLM-powered reasoning
- **Image analysis** — Process images sent by users (with `image` input type)
- **Content generation** — Create structured outputs (reports, emails)

## Cloning

Tools can be cloned to create variations with different prompts, parameters, or LLM settings.
