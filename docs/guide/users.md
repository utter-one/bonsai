# Users

**Users** represent end users who participate in conversations. They are project-scoped entities that track identity and profile data across multiple conversation sessions.

## Structure

| Field | Description |
|---|---|
| `id` | Unique identifier (auto-generated with `usr_` prefix if not provided) |
| `projectId` | Parent project |
| `profile` | Flexible key-value object storing user profile data |
| `createdAt` | Creation timestamp |
| `updatedAt` | Last update timestamp |

## User Creation

Users can be created in two ways:

### Manual Creation

Create users explicitly via the REST API:

```bash
curl -X POST http://localhost:3000/api/projects/my-project/users \
  -H "Authorization: Bearer eyJhbG..." \
  -H "Content-Type: application/json" \
  -d '{
    "id": "user-123",
    "profile": {
      "name": "Jane Doe",
      "preferredLanguage": "en"
    }
  }'
```

### Auto-Creation

When a project has `autoCreateUsers` set to `true`, users are automatically created on their first WebSocket conversation. The auto-created user gets an empty profile (`{}`), which can be populated during the conversation via the `modify_user_profile` effect.

## Profile Variables

The `profile` field is a flexible `Record<string, unknown>` — it can hold any key-value data. Profile data persists across conversations, making it useful for:

- User preferences (language, timezone, communication style)
- Accumulated data (loyalty tier, purchase history)
- State that spans multiple sessions (onboarding progress, verification status)

### Modifying Profiles During Conversations

The `modify_user_profile` effect can update profile fields at runtime:

```json
{
  "type": "modify_user_profile",
  "modifications": [
    { "fieldName": "preferredLanguage", "operation": "set", "value": "es" },
    { "fieldName": "interactionCount", "operation": "set", "value": "{{vars.count}}" }
  ]
}
```

Supported operations: `set`, `reset`, `add`, `remove`. Values support Handlebars templating.

See [Actions & Effects](./actions-and-effects) for full details on the `modify_user_profile` effect.

### Profile Variable Descriptors

Projects can define a `userProfileVariableDescriptors` schema that documents the expected shape of user profiles:

```json
{
  "userProfileVariableDescriptors": [
    { "name": "preferredLanguage", "type": "string", "isArray": false },
    { "name": "loyaltyTier", "type": "string", "isArray": false },
    { "name": "purchaseHistory", "type": "object", "isArray": true, "objectSchema": [
      { "name": "productId", "type": "string", "isArray": false },
      { "name": "amount", "type": "number", "isArray": false }
    ]}
  ]
}
```

This schema is defined on the [Project](./projects) and serves as documentation for what `modify_user_profile` effects operate on. It helps ensure a consistent profile shape across all stages and agents.

## Profile in Conversation Context

User profile data is available in prompts and scripts during conversations:

- **Handlebars templates**: Access via <code v-pre>{{userProfile.fieldName}}</code>
- **Scripts**: Access via `context.userProfile.fieldName`
- **Conditions**: Use in action/guardrail conditions, e.g., `userProfile.verified === true`

## Archival

Users do not have their own archive state. When a project is archived, all its users appear as `archived: true` in API responses. Write operations (create, update, delete) are rejected while the project is archived.

## Common Operations

- **Create** — `POST /api/projects/:projectId/users`
- **List** — `GET /api/projects/:projectId/users` (with pagination, search, and filtering)
- **Get** — `GET /api/projects/:projectId/users/:id`
- **Update** — `PUT /api/projects/:projectId/users/:id`
- **Delete** — `DELETE /api/projects/:projectId/users/:id`

See the [Users API reference](/api/users) for full details.
