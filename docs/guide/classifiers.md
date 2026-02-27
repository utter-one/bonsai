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

The `prompt` field guides how the LLM classifies input. It's a Handlebars template with access to stage variables and conversation context:

```
Analyze the user's message and determine which of the following actions
best matches their intent. Consider the conversation context and any
previous interactions.

If the user's message is a simple acknowledgment or doesn't match any
action, return no matches.
```

The system automatically appends the available actions list and user input to this prompt.

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
