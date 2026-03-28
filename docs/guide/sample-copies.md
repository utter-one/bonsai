# Sample Copies

**Sample Copies** provide a mechanism for delivering pre-written, prescripted responses in conversations. Instead of the AI generating a response from scratch, the system can select from a curated set of variant answers and inject them into the conversation — either as context hints for the LLM, or as direct responses that bypass generation entirely.

## How It Works

On each conversation turn, the system:

1. **Classifies user input** — A dedicated sample copy classifier (LLM-powered) evaluates the user's message against all applicable sample copies' `promptTrigger` descriptions.
2. **Selects a sample copy** — If the classifier matches a sample copy, it returns the copy's `name`.
3. **Samples content** — The distributor picks `amount` items from the copy's `content` array using the configured `samplingMethod`.
4. **Injects or forces** — Depending on `mode`, the selected content is either injected into the prompt context or returned directly as the AI response.

> **Note:** Sample copy classification runs in parallel with other classifiers. If the stage prompt does not contain <code v-pre>{{copy}}</code> or <code v-pre>{{copy.</code> the system skips sample copy processing entirely for that stage.

## Template Variables

Add <code v-pre>{{copy}}</code> to your stage prompt to enable sample copy injection. The following variables are available in templates when sample copies are active:

| Variable | Type | Description |
|---|---|---|
| <code v-pre>{{copy}}</code> | `string` | The selected copy content, joined by newlines. Empty string if no copy was matched. |
| <code v-pre>{{copyContent}}</code> | `string` | Same as `copy` — raw selected content before any decorator is applied. |
| <code v-pre>{{sampleCopy}}</code> | `SampleCopyItem[]` | All sample copies active for this stage, exposing `name`, `trigger`, and `content`. |

Example stage prompt usage:

```handlebars
{{agent}}

You are a customer service agent.

{{#if copy}}
Use the following prescripted answer for this question:
{{copy}}
{{/if}}
```

## Sampling Methods

| Method | Behaviour |
|---|---|
| `random` | Shuffles the `content` array and returns the first `amount` items. Each turn is independent. |
| `round_robin` | Cycles through `content` sequentially. State is preserved for the entire conversation session. |

When `amount` is greater than `1`, multiple items are selected and joined with newlines before being injected as `{{copy}}`.

## Modes

### `regular` (default)

The selected copy content is injected into the prompt as `{{copy}}`. The LLM uses it as guidance but may rephrase or expand on it. Other action effects (stage navigation, variable updates, etc.) still apply.

### `forced`

The selected content is returned **directly as the AI response**, bypassing the LLM entirely. This is useful for strict compliance scenarios, legal disclaimers, or any situation where the exact wording must be preserved. When forced mode is active, response-related action effects are ignored.

## Scoping

Sample copies can be scoped to specific **stages** and/or **agents**:

- `stages` — If set, the copy is only available in the listed stage IDs. Empty or `null` means all stages.
- `agents` — If set, the copy is only available when the stage's agent is in the list. Empty or `null` means all agents.

Both conditions must be satisfied for a sample copy to be considered for a given stage.

## Classifier Configuration

Sample copy classification requires a classifier to be configured at the project level:

- Go to **Project settings** → `sampleCopyConfig.defaultClassifierId`.
- This classifier receives a list of all active sample copies and their `promptTrigger` descriptions, then returns the name of the best match (or `null` if none apply).
- Individual sample copies can override the project classifier by setting `classifierOverrideId`.

## Copy Decorators

A **Copy Decorator** is a template string applied to the selected content before injection. Decorators let you add surrounding text, formatting, or instructions without modifying each sample copy's content individually.

To use a decorator, set `decoratorId` on the sample copy to the ID of a copy decorator. The decorator's `template` field receives the selected content and wraps it.

See [Copy Decorators](../api/copy-decorators) for the API reference.

## Conversation Events

When a sample copy is selected (or not selected) on a turn, a `sample_copy_selection` event is emitted to the conversation event log:

| Field | Description |
|---|---|
| `classifierId` | ID of the classifier that performed selection |
| `input` | The user input text that triggered classification |
| `sampleCopy` | Name of the selected sample copy, or `null` if none was matched |

## Example

The following example shows a sample copy for a product return policy that is activated by questions about returns:

```json
{
  "name": "return-policy",
  "promptTrigger": "Activate when the user asks about returning a product, refund policy, or exchange",
  "content": [
    "Our return policy allows returns within 30 days of purchase. Items must be unused and in original packaging. Refunds are processed within 5–7 business days.",
    "You can return any unused item within 30 days for a full refund. Please keep the original packaging. Refunds take up to 7 business days."
  ],
  "amount": 1,
  "samplingMethod": "round_robin",
  "mode": "regular"
}
```

With `round_robin`, the first call will use the first variant, the second call will use the second variant, and so on.

## References

- [Sample Copies API](../api/sample-copies) — Full REST API reference, including clone and audit log endpoints
- [Copy Decorators API](../api/copy-decorators) — Copy decorator management API
- [Classifiers](./classifiers) — How to configure classifiers used by sample copy classification
- [Templating](./templating) — Handlebars template reference for using `{{copy}}` in prompts
- [Conversations](./conversations) — Conversation event types including `sample_copy_selection`
