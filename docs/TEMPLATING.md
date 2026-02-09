# Handlebars Templating Guide

This guide explains how to use Handlebars templates with ConversationContext in prompts, classifiers, and other parts of the system.

## Overview

The system uses [Handlebars](https://handlebarsjs.com/) as a templating engine to dynamically generate prompts and messages based on conversation context. Templates can access conversation data, user information, stage settings, and more.

## ConversationContext Structure

Templates have access to the following context fields:

### Core Fields

- **`conversationId`** (string): Unique identifier for the conversation

### Data Fields

- **`persona`** (string, optional): Persona prompt that defines AI personality and behavior
  ```handlebars
  {{persona}}
  ```

- **`vars`** (object): Stage variables - custom data stored per stage
  ```handlebars
  {{vars.customerName}}
  {{vars.orderNumber}}
  ```

- **`userProfile`** (object): User profile data
  ```handlebars
  {{userProfile.name}}
  {{userProfile.email}}
  ```

- **`history`** (array): Conversation message history
  ```handlebars
  {{#each history}}
  {{role}}: {{content}}
  {{/each}}
  ```

### Input & Actions

- **`userInput`** (string, optional): Current user input text
- **`userInputSource`** (string, optional): Source of input ('text' or 'voice')
- **`originalUserInput`** (string, optional): Unmodified user input before processing
- **`actions`** (object): Detected or explicitly called actions with parameters
  ```handlebars
  {{#if actions.transfer_call}}
  Transferring to: {{actions.transfer_call.parameters.department}}
  {{/if}}
  ```

### Results

- **`results`** (object): Results from webhooks and tools
  ```handlebars
  {{results.webhooks.customer_data.account_balance}}
  {{results.tools.sentiment_analysis.score}}
  ```

### Stage Information (Optional)

- **`stage`** (object, optional): Current stage configuration
  - **`stage.name`** (string): Display name of the stage
  - **`stage.availableActions`** (array): Actions that can be triggered by user input
  - **`stage.useKnowledge`** (boolean): Whether knowledge base is enabled
  - **`stage.enterBehavior`** (string): 'generate_response' or 'await_user_input'
  - **`stage.metadata`** (object): Custom stage metadata

## Built-in Handlebars Helpers

### Data Access

#### `get` - Safe nested property access
```handlebars
{{get vars "customer.preferences.language"}}
{{get userProfile "settings.notifications.email"}}
```

#### `exists` - Check if value exists
```handlebars
{{#exists userProfile.email}}
User email: {{userProfile.email}}
{{/exists}}

{{#exists vars.orderId}}
Order ID is set
{{else}}
No order ID found
{{/exists}}
```

#### `default` - Provide default value
```handlebars
Hello {{default userProfile.name "Guest"}}!
Language: {{default vars.language "English"}}
```

### Arrays

#### `join` - Join array elements
```handlebars
{{join stage.availableActions ", "}}
Tags: {{join userProfile.tags " | "}}
```

#### `hasItems` - Check if array has elements
```handlebars
{{#hasItems history}}
Previous conversation history available
{{/hasItems}}
```

#### `contains` - Check if array contains value
```handlebars
{{#contains userProfile.roles "admin"}}
User is an administrator
{{/contains}}
```

### Comparison Operators

#### `eq` - Equality
```handlebars
{{#eq userInputSource "voice"}}
User spoke this message
{{/eq}}
```

#### `ne` - Not equal
```handlebars
{{#ne stage.enterBehavior "generate_response"}}
Waiting for user input
{{/ne}}
```

#### `gt`, `gte`, `lt`, `lte` - Numeric comparisons
```handlebars
{{#gt history.length 5}}
This conversation has more than 5 messages
{{/gt}}

{{#lte vars.attempts 3}}
Attempts remaining: {{vars.attempts}}
{{/lte}}
```

### Logical Operators

#### `and` - Logical AND
```handlebars
{{#and userProfile.verified stage.useKnowledge}}
Verified user with knowledge access
{{/and}}
```

#### `or` - Logical OR
```handlebars
{{#or vars.isPriority userProfile.vip}}
This is a priority conversation
{{/or}}
```

#### `not` - Logical NOT
```handlebars
{{#not vars.completed}}
Conversation is still in progress
{{/not}}
```

### Utilities

#### `json` - Convert to JSON
```handlebars
{{json vars}}
{{json userProfile true}}  <!-- pretty-printed -->
```

## Common Usage Patterns

### Listing Available Actions

```handlebars
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
```

### Personalizing Greetings

```handlebars
Hello {{default userProfile.firstName "there"}}!

{{#exists userProfile.lastVisit}}
Welcome back! Your last visit was on {{userProfile.lastVisit}}.
{{else}}
Welcome! This is your first time here.
{{/exists}}
```

### Conditional Content Based on Conversation History

```handlebars
{{#gt history.length 0}}
Based on our previous conversation:
{{#each history}}
{{#eq role "user"}}
You said: {{content}}
{{/eq}}
{{/each}}
{{else}}
This is the start of our conversation.
{{/gt}}
```

### Using Stage Variables

```handlebars
{{#exists vars.currentStep}}
You are at step {{vars.currentStep}} of the process.
{{/exists}}

{{#eq vars.status "pending"}}
Your request is being processed.
{{/eq}}

{{#and vars.authenticated vars.hasAccess}}
You have full access to this feature.
{{/and}}
```

### Accessing Action Results

```handlebars
{{#if actions.check_balance}}
Account Balance: ${{actions.check_balance.parameters.amount}}
{{/if}}

{{#exists results.webhooks.customer_api}}
Customer Data Retrieved:
{{json results.webhooks.customer_api true}}
{{/exists}}
```

### Knowledge Base Context

```handlebars
{{#if stage.useKnowledge}}
I have access to the knowledge base and can answer questions about:
{{#if stage.metadata.knowledgeTopics}}
{{join stage.metadata.knowledgeTopics ", "}}
{{/if}}
{{else}}
I don't have access to the knowledge base in this stage.
{{/if}}
```

## Example: Complete Classifier Prompt

```handlebars
You are a classifier for a customer service conversation in stage "{{stage.name}}".

User Profile:
- Name: {{default userProfile.name "Unknown"}}
- Account Type: {{default userProfile.accountType "Standard"}}
{{#exists userProfile.preferences}}
- Preferences: {{json userProfile.preferences}}
{{/exists}}

Current Stage Context:
- Stage Variables: {{json vars}}
- Knowledge Base: {{#if stage.useKnowledge}}Enabled{{else}}Disabled{{/if}}

{{#if stage.availableActions}}
Available Actions:
{{#each stage.availableActions}}
{{@index}}. {{name}}
   {{#if examples}}Examples: "{{join examples "\", \""}}"{{/if}}
   {{#if parameters}}
   Required parameters: {{#each parameters}}{{#if required}}{{name}}{{/if}}{{/each}}
   {{/if}}
{{/each}}
{{/if}}

{{#gt history.length 0}}
Recent Conversation History:
{{#each history}}
{{role}}: {{content}}
{{/each}}
{{/gt}}

Classify the user's intent from the following input and extract any parameters.
```

## Example: Stage System Prompt

```handlebars
You are a helpful AI assistant for {{vars.companyName}}.

{{#exists userProfile.name}}
You are speaking with {{userProfile.name}}.
{{/exists}}

{{#if stage.useKnowledge}}
You have access to our knowledge base. Use it to provide accurate information.
{{/if}}

Current conversation context:
{{#exists vars.topic}}
- Current topic: {{vars.topic}}
{{/exists}}
{{#exists vars.priority}}
- Priority level: {{vars.priority}}
{{/exists}}

{{#gt history.length 0}}
Conversation so far:
{{#each history}}
{{role}}: {{content}}
{{/each}}
{{/gt}}

Guidelines:
- Be friendly and professional
- {{#eq userProfile.language "es"}}Respond in Spanish{{else}}Respond in English{{/eq}}
- {{#if vars.requiresEscalation}}Prepare to escalate to human agent{{/if}}
```

## Best Practices

1. **Always use safe accessors**: Use `{{#exists}}` or `{{default}}` for optional fields
2. **Handle missing data gracefully**: Provide fallbacks for user-facing content
3. **Keep templates readable**: Use proper indentation and comments
4. **Test with empty context**: Ensure templates work when fields are undefined
5. **Avoid complex logic**: Keep template logic simple; handle complex operations in code
6. **Use meaningful variable names**: Make templates self-documenting
7. **Cache awareness**: Templates are automatically cached; identical templates render faster

## Debugging Templates

If a template doesn't render as expected:

1. **Check the context**: Use `{{json vars}}` to see what data is available
2. **Test incrementally**: Build templates piece by piece
3. **Check logs**: Template rendering errors are logged with details
4. **Verify field names**: Field names are case-sensitive
5. **Use exists checks**: Wrap optional fields in `{{#exists}}` blocks

## Two-Pass Rendering

The templating engine performs two-pass rendering, allowing you to generate dynamic template expressions. This is useful when you need to dynamically construct template expressions based on context values.

**How it works:**
1. First pass: The template is rendered with the context
2. If the result still contains `{{}}` expressions, a second pass is performed
3. After two passes, any remaining `{{}}` expressions trigger a warning and are left as-is

**Example:**
```handlebars
{{!-- First pass: Resolves vars.currentLanguage to "en" --}}
{{!-- Result after first pass: {{vars.en_greeting}} --}}
{{!-- Second pass: Resolves vars.en_greeting to "Hello" --}}
{{vars.{{vars.currentLanguage}}_greeting}}
```

If `vars.currentLanguage = "en"` and `vars.en_greeting = "Hello"`, the result would be "Hello".

**Note**: This feature should be used sparingly as it adds complexity. Consider restructuring your data if you find yourself relying on it heavily.
