---
title: "ClientMessageHandlerRegistry exposes internal state and crashes at module load"
severity: high
status: resolved
created: 2026-05-29
updated: 2026-05-29
assignee: ""
tags: [crash, type-safety, channels]
---

# ClientMessageHandlerRegistry exposes internal state and crashes at module load

## Description

Multiple HIGH issues in `ClientMessageHandlerRegistry.ts`:

1. **Line 36-38**: `getAll()` exposes internal Map directly. Callers can mutate registry state.
2. **Line 67-72**: Decorator executes `container.resolve()` eagerly at class-definition time. Crash during module loading with obscure error.

## Steps to Reproduce

1. Register a handler with a service that fails to resolve
2. Observe crash during module loading, not at runtime

## Expected Behavior

`getAll()` should return a copy or readonly Map. Decorator should defer resolution until first use.

## Actual Behavior

Internal Map is exposed for mutation. Container resolution at class-definition time causes obscure startup crashes.

## Notes

File: `src/channels/ClientMessageHandlerRegistry.ts`
