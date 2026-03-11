# Bonsai Backend

Backend for building and running AI-powered voice and text conversation pipelines. Provides a REST API and a real-time WebSocket API for designing, deploying, and managing multi-turn AI conversations with support for multiple LLM, TTS, and ASR providers.

## Features

- **REST API** — full resource management: projects, stages, agents, classifiers, context transformers, tools, knowledge base, providers, conversations, and more
- **Real-time WebSocket API** — streaming conversation pipeline: ASR → classification → context transformation → LLM generation → TTS synthesis
- **Multi-provider AI integrations** — OpenAI, Anthropic, Google Gemini for LLM; Azure, Speechmatics, AssemblyAI for ASR/TTS; S3/Azure/GCS for storage
- **RBAC + JWT & API key authentication** — role-based access control enforced at both controller and service layers
- **Scripting sandbox** — safely execute custom JavaScript logic inside conversations via `isolated-vm`
- **Handlebars templating** — dynamic prompt and message composition with full variable context
- **OpenAPI / Swagger UI** — self-documenting API available at `/api-docs`
- **Docker-ready** — single-stage image with automatic database migrations on startup

## Prerequisites

- Node.js 20+
- PostgreSQL 14+

## Quick Start

```bash
git clone https://github.com/your-org/bonsai-backend.git
cd bonsai-backend

cp .env.example .env
# Edit .env — set DB_CONNECTION_STRING and JWT_SECRET at minimum

npm install
npm run dev
```

The server starts on `http://localhost:3000` by default.

## Environment Variables

| Variable | Required | Description | Default |
|---|---|---|---|
| `DB_CONNECTION_STRING` | Yes | PostgreSQL connection string | `postgresql://postgres:...@localhost:5432/bonsai` |
| `JWT_SECRET` | Yes | Secret for signing JWTs (minimum 32 characters) | — |
| `PORT` | No | HTTP server port | `3000` |
| `NODE_ENV` | No | Runtime environment (`development` / `production`) | `development` |
| `DB_POOL_SIZE` | No | Database connection pool size | `10` |
| `DB_SSL` | No | Enable SSL for the database connection | `true` |
| `CORS_ORIGIN` | No | Allowed CORS origin | `*` |

## Scripts

| Script | Description |
|---|---|
| `npm run dev` | Generate schemas, run migrations, start development server |
| `npm start` | Run migrations and start the server |
| `npm run build` | Regenerate WebSocket JSON Schema and compile TypeScript |
| `npm run db:generate` | Generate a new Drizzle migration from schema changes |
| `npm run db:migrate` | Apply pending migrations to the database |
| `npm run db:studio` | Open Drizzle Studio to browse the database |
| `npm run schemas:generate` | Regenerate `schemas/websocket-contracts.json` |

## Docker

```bash
docker build -t bonsai-backend .

docker run -p 3000:3000 \
  -e DB_CONNECTION_STRING="postgresql://user:pass@host:5432/bonsai" \
  -e JWT_SECRET="your-secret-key-min-32-chars" \
  bonsai-backend
```

Database migrations run automatically on container startup before the application starts. The container exposes a health check endpoint at `GET /health`.

## API & Documentation

- **Full documentation** — see the [docs/](docs/) directory (built with VitePress)
- **Swagger UI** — available at `/api-docs` when the server is running
- **OpenAPI spec** — available at `/openapi.json`
- **WebSocket contracts** — JSON Schema available at `/websocket-contracts.json`

## License

Licensed under the [Apache License 2.0](LICENSE)
