---
title: "WebSocketChannelHost unhandled async rejections and NaN payload"
severity: high
status: resolved
created: 2026-05-29
updated: 2026-05-29
assignee: ""
tags: [crash, websocket]
---

# WebSocketChannelHost unhandled async rejections and NaN payload

## Description

Multiple HIGH issues in `WebSocketChannelHost.ts`:

1. **Line 198-200**: `sendError` doesn't check `ws.readyState` before `ws.send()`. Throws if socket closing/closed.
2. **Line 63-64**: `handleMessage` async but called without `await` or `.catch()`. Unhandled rejections crash process.
3. **Line 67**: `ws.on('close')` callback doesn't `await` async `handleDisconnect`. Rejections unhandled.

## Steps to Reproduce

1. Trigger an error in handleMessage
2. Observe unhandled promise rejection

## Expected Behavior

Async handlers should be properly awaited or caught. WebSocket readyState checked before send.

## Actual Behavior

Unhandled rejections crash process. Unchecked WebSocket sends.

## Notes

File: `src/channels/websocket/WebSocketChannelHost.ts`
