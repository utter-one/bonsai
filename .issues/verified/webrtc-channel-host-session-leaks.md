---
title: "WebRTCChannelHost session leaks and unhandled rejections"
severity: high
status: resolved
created: 2026-05-29
updated: 2026-05-29
assignee: ""
tags: [resource-leak, crash, webrtc]
---

# WebRTCChannelHost session leaks and unhandled rejections

## Description

Multiple HIGH issues in `WebRTCChannelHost.ts`:

1. **Line 214-218**: `cleanupPeerConnection` never calls `unregisterSession()`. Session remains registered indefinitely (resource leak).
2. **Line 245-246**: `getSession(sessionId)` result passed to `attachSession()` without null check. Crashes if null.
3. **Line 254-265**: `audioSink.ondata` captures `session` by reference. After unregister, closure accesses stale session.
4. **Line 268-270**: `handleControlMessage` called without `await`/`.catch()`. Unhandled rejection can crash process.
5. **Line 356-363**: `cleanupPeerConnection` never calls `sessionManager.unregisterSession()`. Session leaks.

## Steps to Reproduce

1. Close a WebRTC peer connection
2. Observe session remains registered in SessionManager

## Expected Behavior

Session should be unregistered on cleanup. Null checks on session lookup.

## Actual Behavior

Session leaks. Unhandled rejections. Stale session references.

## Notes

File: `src/channels/webrtc/WebRTCChannelHost.ts`
