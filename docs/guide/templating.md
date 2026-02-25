# Prompt Templating

Nexus Backend uses **Handlebars** as its templating engine for all prompts — stage system prompts, persona prompts, tool prompts, and various effect templates. This allows dynamic content injection based on conversation state.

## Available Variables

Templates have access to these data contexts:

| Variable | Description |
|---|---|
| `vars` | Current stage variables |
| `userProfile` | End user's profile data |
| `constants` | Project-level constants |
| `userInput` | Current user input text |
| `history` | Conversation message history (auto-injected) |
| `context.results` | Results from tool calls, webhooks, and actions |

## Basic Syntax

### Variable Interpolation

```handlebars
Hello {{userProfile.name}}, welcome to {{constants.companyName}}.
```

### Nested Properties

```handlebars
Your order {{vars.order.id}} is currently {{vars.order.status}}.
```

## Built-in Helpers

Nexus Backend registers custom Handlebars helpers for common operations:

### `get` — Safe Nested Access

Safely access nested properties without errors if intermediate values are undefined:

```handlebars
{{get vars "customer.address.city"}}
```

### `exists` — Check Value Existence

Block helper that renders content only if a value exists (is not null/undefined):

```handlebars
{{#exists vars.customerName}}
The customer's name is {{vars.customerName}}.
{{/exists}}
```

### `hasItems` — Check Array Length

Block helper that renders content only if an array has elements:

```handlebars
{{#hasItems vars.pendingOrders}}
You have {{vars.pendingOrders.length}} pending orders.
{{/hasItems}}
```

### `join` — Join Array Elements

Join array elements with a separator:

```handlebars
Available sizes: {{join vars.sizes ", "}}
```

### `contains` — Check Array Membership

Check if an array contains a specific value:

```handlebars
{{#contains vars.features "premium"}}
You have access to premium features.
{{/contains}}
```

### `default` — Fallback Values

Provide a fallback value if the primary value is undefined:

```handlebars
Hello {{default userProfile.name "valued customer"}}!
```

### `json` — JSON Stringify

Convert a value to its JSON string representation:

```handlebars
Current variables: {{json vars}}
```

## Template Caching

Templates are compiled and cached for performance (up to 1,000 templates). Caching is transparent — when a prompt changes, the new version is automatically compiled on next use.

## Usage in Prompts

### Stage System Prompt

```handlebars
You are a {{constants.agentRole}} for {{constants.companyName}}.

{{#exists vars.customerName}}
You are speaking with {{vars.customerName}}.
{{/exists}}

{{#exists vars.issue}}
Current issue: {{vars.issue}}
Resolution steps taken so far:
{{#hasItems vars.steps}}
{{#each vars.steps}}
- {{this}}
{{/each}}
{{/hasItems}}
{{/exists}}

Always be polite and professional. If you cannot help, offer to escalate.
```

### Effect Templates

The `modify_user_input` effect uses Handlebars:

```handlebars
Context: The user has order {{vars.orderId}} with status {{vars.orderStatus}}.
User's question: {{userInput}}
```

The `call_webhook` effect supports Handlebars in URLs and body:

```handlebars
https://api.example.com/orders/{{vars.orderId}}/status
```

## Best Practices

- **Use `exists` guards** — Prevent rendering undefined values in prompts
- **Keep prompts focused** — Include only relevant context for each stage
- **Use constants for shared values** — Avoid hardcoding company names, URLs, etc.
- **Leverage variables** — Use stage variables to build progressive context across turns
- **Test with edge cases** — Consider what happens when variables are empty or unset
