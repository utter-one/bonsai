# Prompt Templating

Bonsai Backed uses **Handlebars** as its templating engine for all prompts — stage system prompts, agent prompts, tool prompts, and various effect templates. This allows dynamic content injection based on conversation state.

## Available Variables

Templates have access to these data contexts:

| Variable | Description |
|---|---|
| `vars` | Current stage variables |
| `userProfile` | End user's profile data |
| `consts` | Project-level constants |
| `userInput` | Current user input text |
| `history` | Conversation message history (auto-injected) |
| `context.results` | Results from tool calls, webhooks, and actions |
| `time` | Current date/time context, timezone-aware (see [Time Context](#time-context)) |

## Basic Syntax

### Variable Interpolation

```handlebars
Hello {{userProfile.name}}, welcome to {{consts.companyName}}.
```

### Nested Properties

```handlebars
Your order {{vars.order.id}} is currently {{vars.order.status}}.
```

## Built-in Helpers

Bonsai Backed registers custom Handlebars helpers for common operations:

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
You are a {{consts.agentRole}} for {{consts.companyName}}.

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

---

## Time Context

Every prompt template receives a `time` object containing the current date and time anchored to the conversation's resolved timezone. This eliminates LLM hallucinations on date/time questions and gives prompt authors first-class support for relative date expressions like "next Tuesday" or "this week".

### Timezone Precedence

The timezone is resolved once when the conversation starts and persisted for its lifetime:

```
start_conversation.timezone
  → userProfile.timezone
  → project.timezone
  → UTC (fallback)
```

Set a project-wide default in project settings (`timezone` field, IANA identifier e.g. `Europe/Warsaw`). Override per-conversation by passing `timezone` in the WebSocket `start_conversation` message. Override per-user by storing `timezone` in the user's profile JSON.

### Quick Start — LLM Grounding

Drop the pre-formatted anchor sentence at the top of any system prompt:

```handlebars
{{time.anchor}}
```

This produces a single sentence the LLM can consume immediately, e.g.:

> Today is Friday, 27 February 2026 (Europe/Warsaw, UTC+01:00). This week (Mon–Sun): 23 Feb–1 Mar. Next week: 2 Mar–8 Mar. Next Mon: 2 Mar, Tue: 3 Mar, Wed: 4 Mar, Thu: 5 Mar, Fri: 6 Mar, Sat: 7 Mar, Sun: 8 Mar.

### Current Moment Fields

| Field | Example | Description |
|---|---|---|
| `time.iso` | `"2026-02-27T14:30:00.000+01:00"` | Full ISO 8601 timestamp |
| `time.timestamp` | `1772150200000` | Unix epoch (ms) |
| `time.date` | `"2026-02-27"` | Date in YYYY-MM-DD |
| `time.time` | `"14:30:00"` | Time in HH:MM:SS (24-hour) |
| `time.dateTime` | `"2026-02-27 14:30:00"` | Combined date and time |
| `time.year` | `"2026"` | Four-digit year |
| `time.month` | `"02"` | Zero-padded month |
| `time.day` | `"27"` | Zero-padded day of month |
| `time.hour` | `"14"` | Zero-padded hour (24-h) |
| `time.minute` | `"30"` | Zero-padded minute |
| `time.second` | `"00"` | Zero-padded second |
| `time.monthName` | `"February"` | Full month name |
| `time.monthNameShort` | `"Feb"` | Abbreviated month name |
| `time.dayOfWeek` | `"Friday"` | Full weekday name |
| `time.dayOfWeekShort` | `"Fri"` | Abbreviated weekday name |
| `time.timezone` | `"Europe/Warsaw"` | IANA timezone identifier in use |
| `time.offset` | `"+01:00"` | UTC offset string |

### Relative Date Fields

These fields always hold the date (YYYY-MM-DD) of the **next occurrence** of each weekday, or today if today is that weekday. They are essential for booking, scheduling, and reminder scenarios.

| Field | Description |
|---|---|
| `time.nextMonday` | Date of next (or current) Monday |
| `time.nextTuesday` | Date of next (or current) Tuesday |
| `time.nextWednesday` | Date of next (or current) Wednesday |
| `time.nextThursday` | Date of next (or current) Thursday |
| `time.nextFriday` | Date of next (or current) Friday |
| `time.nextSaturday` | Date of next (or current) Saturday |
| `time.nextSunday` | Date of next (or current) Sunday |

### Upcoming Calendar

`time.calendar` is an array of the next **14 days** starting from today. Each entry has:

| Property | Type | Description |
|---|---|---|
| `date` | `string` | YYYY-MM-DD |
| `dayName` | `string` | Full weekday name, e.g. `"Monday"` |
| `dayNameShort` | `string` | Abbreviated, e.g. `"Mon"` |
| `month` | `string` | Full month name, e.g. `"March"` |
| `dayOfMonth` | `number` | Day of month, e.g. `2` |
| `isToday` | `boolean` | `true` for the first entry (today) |

Render it with <span v-pre>`{{{json time.calendar}}}`</span> to give a structured LLM model the full two-week window:

```handlebars
Available dates for the next two weeks:
{{{json time.calendar}}}
```

### Examples

**Booking assistant — anchor + specific day reference:**
```handlebars
{{time.anchor}}

You are a booking assistant. Today is {{time.dayOfWeek}} {{time.date}}.
When the user says "next Tuesday", that is {{time.nextTuesday}}.
When the user says "this Friday", that is {{time.nextFriday}}.
```

**Appointment reminder with full date:**
```handlebars
Your appointment is on {{vars.appointmentDate}}. Today is {{time.date}} ({{time.dayOfWeek}}),
so that is {{vars.daysUntil}} days away.
```

**Show current time and timezone to user:**
```handlebars
The current time is {{time.time}} {{time.timezone}} (UTC{{time.offset}}).
```
