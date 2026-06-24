---
title: "WebRTCConnection unguarded session access and timer leaks"
severity: high
status: closed
created: 2026-05-29
updated: 2026-06-01
assignee: ""
tags: [crash, resource-leak, webrtc]
---

# WebRTCConnection unguarded session access and timer leaks

## Description

Multiple HIGH issues in `WebRTCConnection.ts`:

1. **Line 122**: `sendMessage` is `async` but contains no `await` — misleading or indicates missing error handling.
2. **Line 123**: `this.session` destructured without null check — crashes if called before `attachSession()`.
3. **Line 294**: Same uninitialized `this.session` access in `pushAudioToTrack()`.
4. **Line 340-352**: `ensureAudioScheduler` has no "closed" guard. New interval started on dead connection, leaking timer.
5. **Line 343-351**: Scheduler `setInterval` callback can fire after `close()`. No guard against destroyed audio source.

## Steps to Reproduce

1. Call sendMessage before attachSession
2. Observe TypeError crash

## Expected Behavior

Session should be guarded. Timer should not start on closed connections.

## Actual Behavior

Uncaught TypeErrors. Timer leaks on dead connections.

## Notes

File: `src/channels/webrtc/WebRTCConnection.ts`

## Verification

Re-opened 2026-05-31: Issues 2-5 are fixed (null guards and closed-state checks added), but issue #1 (`sendMessage` at line 125 is still `async` with no `await`) remains. This is likely intentional to satisfy the IClientConnection interface contract.
