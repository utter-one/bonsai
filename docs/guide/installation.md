# Installation

## Prerequisites

- Node.js 20+
- PostgreSQL database
- Docker (optional)

## Running with Docker

```bash
docker compose up -d
```

## Running Locally

1. Install dependencies:

```bash
npm install
```

2. Copy and configure environment variables:

```bash
cp .env.example .env
```

3. Run database migrations and start the server:

```bash
npm run dev
```

The server starts on `http://localhost:3000` by default.
