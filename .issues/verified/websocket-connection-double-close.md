---
title: "WebSocketConnection double close and unguarded session access"
severity: high
status: resolved
created: 2026-05-29
updated: 2026-05-29
assignee: ""
tags: [crash, websocket]
---

# WebSocketConnection double close and unguarded session access

## Description

Multiple HIGH issues in `WebSocketConnection.ts`:

1. **Line 31**: No guard against double-close. `unregisterSession` fires twice for same session.
2. **Line 31**: `this.session` never initialized. If `close()` called before `attachSession()`, throws TypeError.

## Steps to Reproduce

1. Call close() twice on the same connection
2. Observe double unregister

## Expected Behavior

Close should be idempotent. Session should be guarded.

## Actual Behavior

Double unregister. TypeError on unguarded access.

## Notes

File: `src/channels/websocket/WebSocketConnection.ts`
