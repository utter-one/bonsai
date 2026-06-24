---
title: "Non-null assertion on DB_CONNECTION_STRING crashes drizzle-kit"
severity: high
status: resolved
created: 2026-05-29
updated: 2026-05-29
assignee: ""
tags: [crash, config, drizzle]
---

# Non-null assertion on DB_CONNECTION_STRING crashes drizzle-kit

## Description

`drizzle.config.ts` line 9 uses `process.env.DB_CONNECTION_STRING!` — non-null assertion produces empty `url` if env var is unset. Drizzle-kit crashes at runtime with an obscure error instead of a clear validation message.

## Steps to Reproduce

1. Run drizzle-kit without DB_CONNECTION_STRING env var set
2. Observe obscure crash

## Expected Behavior

Clear error message indicating the required env var is missing.

## Actual Behavior

Undefined is passed to `dbCredentials.url`, causing an obscure runtime crash.

## Notes

File: `drizzle.config.ts`
