---
title: "ClientMessageHandlerContext send and sendError use any and raw string types"
severity: high
status: resolved
created: 2026-05-29
updated: 2026-05-31
assignee: ""
tags: [type-safety, channels]
---

# ClientMessageHandlerContext send and sendError use any and raw string types

## Description

`ClientMessageHandlerContext.ts` line 10: `send` accepts `message: any` — loses all type safety. Should use a discriminated union of message types.

## Steps to Reproduce

1. Pass any arbitrary value to `send()` — no compile-time error

## Expected Behavior

`send` should accept a typed discriminated union of valid message types.

## Actual Behavior

`send` accepts `any`, bypassing all compile-time type checking.

## Notes

File: `src/channels/ClientMessageHandlerContext.ts`
