# API Reference

This section covers the full HTTP REST API and WebSocket API provided by the Nexus Backend.

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
- [Admins](./admins) — Admin user management and profile
- [Version](./version) — API schema version info

### Core Resources
- [Projects](./projects) — Project management
- [Stages](./stages) — Conversation stage configuration
- [Personas](./personas) — AI persona definitions
- [Classifiers](./classifiers) — Intent classifiers
- [Context Transformers](./context-transformers) — Context transformation pipelines
- [Tools](./tools) — LLM tool definitions
- [Global Actions](./global-actions) — Global action handlers

### Data & Content
- [Knowledge](./knowledge) — Knowledge base categories and items
- [Conversations](./conversations) — Conversation history and events
- [Users](./users) — End-user management
- [Issues](./issues) — Issue tracking

### Infrastructure
- [Providers](./providers) — Provider configuration (LLM, TTS, ASR, Storage)
- [Provider Catalog](./provider-catalog) — Available provider catalog
- [API Keys](./api-keys) — API key management
- [Environments](./environments) — Environment and migration management
- [Migration](./migration) — Configuration export/import
- [Audit Logs](./audit-logs) — Audit trail

### Real-time
- [WebSocket](./websocket) — Real-time conversational AI protocol

