# Classifiers

A **Classifier** is an LLM-powered intent detection component. It analyzes user input and determines which actions should be triggered, along with any extracted parameters.

## Structure

| Field | Description |
|---|---|
| `id` | Unique identifier (within project) |
| `projectId` | Parent project |
| `name` | Display name |
| `description` | Optional description |
| `prompt` | Classification prompt template |
| `llmProviderId` | LLM provider for classification |
| `llmSettings` | LLM-specific settings |
| `metadata` | Arbitrary JSON |
| `version` | Optimistic locking version |

## How Classification Works

During each conversation turn, classifiers run in parallel to analyze the user's input:

1. The stage's `defaultClassifierId` defines the primary classifier
2. Individual actions can specify `overrideClassifierId` to use a different classifier
3. The classifier receives:
   - The classification prompt
   - A list of available actions (filtered by conditions)
   - Each action's `classificationTrigger`, `parameters`, and `examples`
   - The current user input
4. The LLM returns which actions match and any extracted parameters

## Classification Prompt

The `prompt` field is a Handlebars template that guides how the LLM classifies input. It has access to the full conversation context **and** the list of available actions for the current stage.

### Template Context

In addition to all standard [template variables](./templating), the classifier prompt receives:

| Variable | Description |
|---|---|
| `stage.availableActions` | Array of actions eligible for classification (conditions already evaluated) |
| `userInput` | The current user's message |

Each entry in `stage.availableActions` exposes:

| Field | Description |
|---|---|
| `id` | Action ID — **this is what the LLM must return as the JSON key** |
| `name` | Display name |
| `trigger` | The `classificationTrigger` label describing when to fire this action |
| `examples` | Example user phrases |
| `parameters` | Parameter definitions (name, type, description, required) |

### Example Prompt

```handlebars
You are a classification assistant. Your task is to analyze user input and extract actions with parameters.

{{#if stage}}
Available actions in this stage:
{{#each stage.availableActions}}
- **{{name}}** (ID: {{id}})
  {{#if examples}}
  Examples: {{join examples ", "}}
  {{/if}}
  {{#if parameters}}
  Parameters:
  {{#each parameters}}
    - {{name}} ({{type}}){{#if required}} *required*{{/if}}: {{description}}
  {{/each}}
  {{/if}}
{{/each}}
{{/if}}

Instructions:
1. Determine the user's actions from their input using the defined actions above.
2. Extract any parameters that match the defined actions for this stage
3. For parameters extraction:
   - Only extract parameters that are explicitly mentioned or strongly implied in the user input
   - For "text" type parameters, extract the relevant text value
   - For "number" type parameters, extract numeric values
4. For action classification:
   - Prioritize defined actions when the user input matches their trigger descriptions
   - Consider the action associated with each intent when making classification decisions
   - Fall back to general actions when no specific intent matches
5. You can only use existing actions.
```

### Required Output Format

The LLM **must** respond with a JSON object in the following format:

```json
{
  "actions": {
    "<actionId>": {
      "paramName": "paramValue"
    },
    "<anotherActionId>": {}
  }
}
```

- Keys are **action IDs** (the `id` field from `stage.availableActions`), not trigger labels or action names
- The value is an object of extracted parameter key–value pairs
- Use an empty object `{}` when the action has no parameters (or none were extracted)
- Omit actions that were not matched — do not include them with empty objects unless they were genuinely triggered

## Multiple Classifiers

A stage can effectively use multiple classifiers:

- One **default classifier** via `defaultClassifierId` on the stage
- Additional classifiers via `overrideClassifierId` on individual actions

When multiple classifiers are involved, they all run in parallel. Actions are distributed to their respective classifiers based on the override setting, and results are merged and deduplicated.

## Classification Results

Each classifier returns:

- **Matched actions** — Which actions the user's input triggered
- **Extracted parameters** — Parameter values pulled from the user's input (name, type, value)

These results feed into the [Actions & Effects](./actions-and-effects) execution pipeline.

## Knowledge Integration

When a stage has `useKnowledge` enabled, knowledge categories are injected as synthetic actions into the classifier's consideration set. If the classifier matches a knowledge category, the relevant FAQ items are included in the response generation context.

## Cloning

Classifiers can be cloned to create variations — for example, a specialized classifier for a particular domain that shares most behavior with a general-purpose one.
