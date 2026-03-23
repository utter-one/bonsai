# bonsai-compose

Docker Compose setup for the Bonsai suite:

| Service | Repository | Default port |
|---|---|---|
| PostgreSQL 16 | `postgres:16-alpine` | — |
| Bonsai Backend | [utter-one/bonsai-backend](https://github.com/utter-one/bonsai) | 3000 |
| Bonsai Console | [utter-one/bonsai-console](https://github.com/utter-one/bonsai-console) | 80 |
| Bonsai Docs | [utter-one/bonsai-backend](https://github.com/utter-one/bonsai) (`docs/`) | 8080 |

## Quick start

```bash
# 1. Clone this repo with submodules
git clone --recurse-submodules https://github.com/utter-one/bonsai.git
cd bonsai/compose

# 2. Configure environment
cp env.example .env
# Open .env and set JWT_SECRET to a random string of at least 32 characters
# Make sure you change POSTGRES_PASSWORD as well - a MUST in production 

# 3. Build and start
docker compose up -d
```

Images are built from the local submodules on first run — this takes a few minutes. Database migrations run automatically when the backend starts.

Once up:
- **Console - admin panel** → http://localhost
- **Backend API** → http://localhost:3000
- **API docs (Swagger UI)** → http://localhost:3000/api-docs
- **API docs (VitePress)** → http://localhost:8080

On a fresh install,  if you are not using Bonsai Console, you need to create the initial operator account via the setup endpoint:

```bash
curl -X POST http://localhost:3000/api/setup/initial-operator \
  -H "Content-Type: application/json" \
  -d '{"id": "admin@example.com", "name": "Admin", "password": "your-password"}'
```

## Configuration

Copy `env.example` to `.env` and adjust as needed.

| Variable | Required | Default | Description |
|---|---|---|---|
| `JWT_SECRET` | **Yes** | — | Token signing secret (min 32 chars) |
| `POSTGRES_PASSWORD` | **Yes** | `bonsai` | PostgreSQL password |
| `BACKEND_PORT` | No | `3000` | Host port for the backend |
| `ADMIN_PORT` | No | `80` | Host port for the Console admin panel |
| `DOCS_PORT` | No | `8080` | Host port for the VitePress API docs |
| `CORS_ORIGIN` | No | `*` | Allowed CORS origin |
| `NODE_ENV` | No | `production` | Runtime environment |
| `DB_POOL_SIZE` | No | `10` | DB connection pool size |
| `LOG_LEVEL` | No | `info` | Log level (`trace`/`debug`/`info`/`warn`/`error`) |

## Useful commands

```bash
# View logs
docker compose logs -f

# Stop the stack
docker compose down

# Rebuild images (e.g. after upstream changes)
docker compose build --no-cache

# Reset everything including the database volume
docker compose down -v
```
