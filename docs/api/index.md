# API Reference

This section covers the full HTTP REST API and WebSocket API provided by the Bonsai Backend.

## Base URL

All REST API endpoints are served under `/api` (except `/version`).

## Authentication

Most endpoints require authentication via JWT tokens or API keys. See [Authentication](./authentication) for details.

Include the token in the `Authorization` header:

```http
Authorization: Bearer <accessToken or apiKey>
```

## Pagination & Filtering

All list endpoints accept common query parameters for pagination, sorting, filtering, and full-text search. See [Pagination & Filtering](./pagination) for details.

## Optimistic Locking

Update and delete operations use optimistic locking via a `version` field. You must supply the current entity version in your request body. If the version doesn't match (another update occurred), you'll receive a `409 Conflict` response.

## OpenAPI / Swagger

A live Swagger UI is available at `/api-docs` on your running instance.

## REST API Sections

### System & Auth
- [Setup](./setup) — Initial system setup
- [Authentication](./authentication) — Login, token refresh
- [Operators](./operators) — Operator user management and profile
- [Version](./version) — API schema version info

### Core Resources
- [Projects](./projects) — Project management
- [Stages](./stages) — Conversation stage configuration
- [Agents](./agents) — AI agent definitions
- [Classifiers](./classifiers) — Intent classifiers
- [Context Transformers](./context-transformers) — Context transformation pipelines
- [Tools](./tools) — LLM tool definitions
- [Global Actions](./global-actions) — Global action handlers
- [Guardrails](./guardrails) — Always-active safety and behavioral rules

### Data & Content
- [Knowledge](./knowledge) — Knowledge base categories and items
- [Sample Copies](./sample-copies) — Pre-written variant answers with classifier-driven selection
- [Copy Decorators](./copy-decorators) — Templates that wrap selected sample copy content
- [Conversations](./conversations) — Conversation history and events
- [Users](./users) — End-user management
- [Issues](./issues) — Issue tracking

### Testing
- [Testers](./testers) — LLM-powered user personas for automated scenario testing
- [Scenarios](./scenarios) — Automated conversation test definitions
- [Scenario Runs & Conversations](./scenario-runs) — Execution tracking for scenario tests

### Analytics
- [Analytics](./analytics) — Conversation analytics and reporting
- [Analytics Query](./analytics-query) — Slice-and-dice analytics engine
- [Analytics Funnel Engine](./analytics-funnels) — Sequential user journey funnels

### Infrastructure
- [Providers](./providers) — Provider configuration (LLM, TTS, ASR, Storage)
- [Provider Catalog](./provider-catalog) — Available provider catalog
- [Secrets](./secrets) — Encrypted secret storage
- [API Keys](./api-keys) — API key management
- [Environments](./environments) — Environment and migration management
- [Migration](./migration) — Configuration export/import
- [Audit Logs](./audit-logs) — Audit trail

### Channels
- [Twilio Voice](./twilio-voice) — Twilio Voice channel integration
- [Twilio Messaging](./twilio-messaging) — Twilio SMS/MMS channel integration
- [WhatsApp](./whatsapp) — WhatsApp Business API channel integration
- [SES Email](./ses-email) — AWS SES email channel integration

### Real-time
- [WebSocket](./websocket) — Real-time conversational AI protocol (WebSocket)
- [WebRTC](./webrtc) — Real-time conversational AI protocol (WebRTC DataChannel, lower audio latency)

