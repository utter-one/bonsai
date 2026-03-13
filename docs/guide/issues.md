# Issues

**Issues** are bug reports and feedback entries linked to specific conversations, sessions, or events within a project. They provide a structured way to track problems encountered during conversational AI interactions.

## Structure

| Field | Type | Description |
|---|---|---|
| `id` | `integer` | Auto-incrementing identifier |
| `projectId` | `string` | Project this issue belongs to |
| `environment` | `string` | Deployment environment (e.g., `production`, `staging`, `development`) |
| `buildVersion` | `string` | Application build version when the issue occurred |
| `stage` | `string \| null` | Stage identifier where the issue occurred |
| `sessionId` | `string \| null` | Related conversation session ID |
| `eventIndex` | `integer \| null` | Index of the specific event in the session where the issue occurred |
| `userId` | `string \| null` | User who reported or encountered the issue |
| `severity` | `string` | Severity level: `critical`, `high`, `medium`, `low` |
| `category` | `string` | Issue category: `bug`, `feature`, `performance` |
| `bugDescription` | `string` | Detailed description of the issue |
| `expectedBehaviour` | `string` | What the expected behavior should have been |
| `comments` | `string` | Additional notes or context |
| `status` | `string` | Current status: `open`, `in_progress`, `resolved`, `closed` |
| `createdAt` | `date` | Creation timestamp |
| `updatedAt` | `date` | Last update timestamp |

## Linking to Conversations

Issues can be linked to specific points in a conversation through three optional fields:

- **`sessionId`** — The WebSocket session ID of the conversation where the issue occurred
- **`eventIndex`** — The specific event index within that session, allowing pinpoint identification of the problematic interaction
- **`stage`** — The stage that was active when the issue occurred

This linkage enables support teams to replay the exact conversation state and context that led to the issue.

## Severity Levels

| Severity | Description |
|---|---|
| `critical` | System-breaking issues affecting all users |
| `high` | Significant problems affecting user experience |
| `medium` | Notable issues with workarounds available |
| `low` | Minor issues or cosmetic problems |

## Status Lifecycle

Issues follow a standard status lifecycle:

```
open → in_progress → resolved → closed
```

| Status | Description |
|---|---|
| `open` | Newly created, awaiting triage |
| `in_progress` | Actively being investigated or fixed |
| `resolved` | Fix has been applied |
| `closed` | Issue verified as resolved or dismissed |

## Use Cases

- **QA feedback** — Testers report conversation flow issues with precise session/event references
- **Production monitoring** — Automatically create issues when conversations encounter errors
- **User complaints** — Track end-user reported problems back to specific conversation turns
- **Performance tracking** — Log latency or quality issues tied to specific stages or builds

## Common Operations

- **Create** — `POST /api/issues`
- **List** — `GET /api/issues` (with pagination, search, and filtering)
- **Get** — `GET /api/issues/:id`
- **Update** — `PUT /api/issues/:id`
- **Delete** — `DELETE /api/issues/:id`

See the [Issues API reference](/api/issues) for full details.
