# Context Transformers

A **Context Transformer** is an LLM-powered component that extracts structured data from a conversation turn and writes it into stage variables. Transformers run in parallel with classifiers on each user input.

## Structure

| Field | Description |
|---|---|
| `id` | Unique identifier (within project) |
| `projectId` | Parent project |
| `name` | Display name |
| `description` | Optional description |
| `prompt` | Extraction prompt template |
| `contextFields` | List of field names to extract/transform |
| `llmProviderId` | LLM provider for extraction |
| `llmSettings` | LLM-specific settings |
| `metadata` | Arbitrary JSON |
| `version` | Optimistic locking version |

## How Transformers Work

1. A stage references transformers via its `transformerIds` array
2. On each user input, all referenced transformers run **in parallel** with classifiers
3. Each transformer receives the conversation context, user input, and existing variable values
4. The LLM returns a JSON object whose schema is described by <code v-pre>{{schema}}</code>
5. Only fields declared in `contextFields` are accepted; any extra fields are discarded
6. The returned values are **merged** into the stage's variable store — fields omitted from the LLM response keep their current values
7. All variable writes from all transformers are flushed to the database in a single batch update

## Extraction Prompt

The `prompt` field guides the LLM on what to extract. It's a Handlebars template with access to the full conversation context.

### Template Variables

| Variable | Description |
|---|---|
| <code v-pre>{{schema}}</code> | **Pseudo-JSON schema** of the expected output — field names and their types derived from `contextFields` cross-referenced with the stage's `variableDescriptors`. Include this in your prompt so the LLM knows the exact JSON structure to return. |
| <code v-pre>{{json context}}</code> | **Current values** of the transformer's context fields. Shows what is already populated so the LLM can decide what to update or leave unchanged. |
| <code v-pre>{{vars.*}}</code> | All stage variables (e.g. <code v-pre>{{vars.customerName}}</code>). |
| <code v-pre>{{userInput}}</code> | The current user message being processed. |
| <code v-pre>{{history}}</code> | Conversation history (array of `{role, content}` entries). |
| <code v-pre>{{userProfile.*}}</code> | User profile fields. |
| <code v-pre>{{time.*}}</code> | Time context anchored to the conversation's timezone. |

A typical prompt using these variables:

```
Extract the following information from the user's message.
Only extract values that are explicitly stated or clearly implied.
Return null for any fields not mentioned.

Return a JSON object matching this schema:
{{schema}}

Current values (only update fields that changed):
{{json context}}
```

### Schema Format

<code v-pre>{{schema}}</code> is a JSON-like object where each value is the field's type label:

```json
{
  "customerName": "string",
  "orderNumber": "string",
  "issueType": "string",
  "itemCount": "number",
  "tags": ["string"],
  "address": {
    "street": "string",
    "city": "string"
  }
}
```

The LLM should respond with a JSON object using the same shape, with actual values instead of type labels.

## Context Fields

The `contextFields` array lists the variable names the transformer will populate:

```json
["customerName", "orderNumber", "issueType"]
```

These field names correspond to the stage's `variableDescriptors`. When the transformer extracts a value, it's **merged into** the stage's variable store — only the fields present in the LLM's JSON response are updated. Fields not returned by the LLM retain their existing values. Unrecognized fields (not listed in `contextFields`) are silently discarded.

## Triggering Actions

Transformers can also trigger actions indirectly. When a transformer writes new or changed values to stage variables, any actions with `triggerOnTransformation: true` and matching `watchedVariables` will activate:

```json
{
  "triggerOnTransformation": true,
  "watchedVariables": {
    "issueType": "new",
    "orderNumber": "changed"
  }
}
```

Watch trigger conditions:
- **`new`** — The variable was not set before and now has a value
- **`changed`** — The variable's value has changed
- **`removed`** — The variable was removed (set to null)

## Use Cases

- **Form filling** — Progressively extract structured data (name, email, phone) from natural conversation
- **Entity extraction** — Pull product names, dates, locations from user messages
- **Sentiment tracking** — Continuously evaluate user sentiment across turns
- **Topic detection** — Identify conversation topic shifts for routing

## Cloning

Context transformers can be cloned to create variations for different stages or extraction requirements.
