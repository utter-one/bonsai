# Tools

A **Tool** is a callable operation within a project. Tools are invoked via the `call_tool` effect in actions, or directly by clients through WebSocket commands. Every tool has a `type` that determines how it executes.

## Tool Types

| Type | Execution | Priority |
|---|---|---|
| `smart_function` | LLM-powered: sends a prompt to an LLM and returns a structured result | Same as `call_tool` (2) |
| `webhook` | HTTP call: makes an outbound HTTP request and stores the response | Same as `call_webhook` (1) |
| `script` | JavaScript: runs code in a secure isolated sandbox | Same as `run_script` (6) |

The `type` field is a discriminator that determines which additional fields are required.

## Common Fields

All tool types share these fields:

| Field | Description |
|---|---|
| `id` | Unique identifier (within project) |
| `projectId` | Parent project |
| `name` | Display name |
| `description` | Optional description |
| `type` | Tool type: `smart_function`, `webhook`, or `script` |
| `parameters` | Array of tool parameter definitions |
| `metadata` | Arbitrary JSON |
| `tags` | Searchable labels for organization |
| `archived` | Whether the tool belongs to an archived project |
| `version` | Optimistic locking version |

## Smart Function Tools

A `smart_function` tool sends a Handlebars-rendered prompt to an LLM and returns the response. This is the most flexible type, supporting text and multimodal inputs and outputs.

**Type-specific fields:**

| Field | Description |
|---|---|
| `prompt` | Handlebars template for the LLM prompt |
| `llmProviderId` | LLM provider to use (falls back to project default) |
| `llmSettings` | LLM-specific settings (temperature, model, etc.) |
| `inputType` | Input modality: `text`, `image`, or `multi-modal` |
| `outputType` | Output modality: `text`, `image`, or `multi-modal` |

**Example:**

```json
{
  "type": "smart_function",
  "name": "Sentiment Analyzer",
  "prompt": "Analyze the sentiment of the following text and respond with a JSON object containing 'score' (-1 to 1) and 'label' (negative/neutral/positive).\n\nText: {{params.text}}",
  "inputType": "text",
  "outputType": "text",
  "parameters": [
    { "name": "text", "type": "string", "description": "Text to analyze", "required": true }
  ]
}
```

The result is stored under `context.results.tools.<toolId>` and is available to subsequent effects and prompt templates.

## Webhook Tools

A `webhook` tool makes an HTTP request to an external service, just like the `call_webhook` effect but reusable across stages. All URL, header, and body fields support Handlebars templating.

**Type-specific fields:**

| Field | Description |
|---|---|
| `url` | Target URL (Handlebars template) |
| `webhookMethod` | HTTP method: `GET`, `POST`, `PUT`, `PATCH`, `DELETE` (default: `POST`) |
| `webhookHeaders` | Key-value map of HTTP headers (values are Handlebars templates) |
| `webhookBody` | Request body string (Handlebars template) |

**Example:**

```json
{
  "type": "webhook",
  "name": "Order Status",
  "url": "https://api.example.com/orders/{{params.orderId}}",
  "webhookMethod": "GET",
  "webhookHeaders": { "Authorization": "Bearer {{consts.apiToken}}" },
  "parameters": [
    { "name": "orderId", "type": "string", "description": "Order ID to look up", "required": true }
  ]
}
```

The HTTP response object is stored under `context.results.webhooks.<toolId>` (same namespace as `call_webhook` effects) and has the shape:

```json
{
  "status": 200,
  "statusText": "OK",
  "headers": { "content-type": "application/json" },
  "data": { ... }
}
```

Inside the Handlebars templates, the tool's resolved parameters are available as `tool.parameters`:

```handlebars
{"query": "{{tool.parameters.searchTerm}}", "limit": {{tool.parameters.maxResults}}}
```

Webhook tools run at **priority 1**, interleaved with `call_webhook` effects.

## Script Tools

A `script` tool runs JavaScript in a secure isolated sandbox, with access to the conversation context and the tool's resolved parameters. Script tools support the full flow control API — they can navigate stages, modify variables, and control the conversation.

**Type-specific fields:**

| Field | Description |
|---|---|
| `code` | JavaScript source code to execute |

**Example:**

```json
{
  "type": "script",
  "name": "Price Calculator",
  "code": "const price = params.quantity * params.unitPrice; vars.totalPrice = price; result = { total: price, formatted: '$' + price.toFixed(2) };",
  "parameters": [
    { "name": "quantity", "type": "number", "description": "Number of units", "required": true },
    { "name": "unitPrice", "type": "number", "description": "Price per unit", "required": true }
  ]
}
```

Inside the script, tool parameters are available as the `params` object:

```javascript
const total = params.quantity * params.unitPrice;
vars.orderTotal = total;
```

The result (assigned to `result`) is stored under `context.results.tools.<toolId>`.

Script tools support the same flow control functions available to `run_script` effects (`goToStage()`, `endConversation()`, etc.) and run at **priority 6**, interleaved with `run_script` effects. See [Scripting](./scripting) for the full scripting API.

## Tool Parameters

All tool types define their input schema via `parameters`:

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

Smart function tools support multimodal inputs and outputs:

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
  "toolId": "order-status",
  "parameters": {
    "orderId": "{{vars.currentOrderId}}"
  }
}
```

The result is stored in the appropriate context bucket (`context.results.tools` or `context.results.webhooks`) and is accessible by subsequent effects and prompt templates.

## Using Tools via WebSocket

Client applications can also invoke tools directly through the `call_tool` WebSocket command, passing the tool ID and parameters. This is useful for tools that the client application triggers explicitly rather than through conversation flow.

## Use Cases

**Smart function:**
- Translation and summarization
- Data lookup using LLM reasoning
- Image analysis with `image` or `multi-modal` input type
- Structured content generation

**Webhook:**
- Order/account status lookups from external APIs
- CRM or ticketing system queries
- Any reusable HTTP integration shared across stages

**Script:**
- Business logic and calculations
- Complex variable manipulation
- Conditional stage navigation based on computed results

## Cloning

Tools can be cloned to create variations with different configurations or implementations.
