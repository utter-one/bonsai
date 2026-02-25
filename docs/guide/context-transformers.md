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
3. Each transformer receives the conversation context, user input, and existing variables
4. The LLM extracts values for the specified `contextFields`
5. Extracted values are written into the stage's variables

## Extraction Prompt

The `prompt` field guides the LLM on what to extract. It's a Handlebars template:

```
Extract the following information from the user's message.
Only extract values that are explicitly stated or clearly implied.
Return null for any fields not mentioned.

Fields to extract:
- customerName: The user's full name
- orderNumber: Any order or reference number mentioned
- issueType: Category of the issue (billing, technical, shipping)
```

## Context Fields

The `contextFields` array lists the variable names the transformer will populate:

```json
["customerName", "orderNumber", "issueType"]
```

These field names correspond to the stage's `variableDescriptors`. When the transformer extracts a value, it's written directly to the stage's variable store.

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
