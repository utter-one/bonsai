---
title: "ChannelCatalog throws plain Error instead of custom error class"
severity: high
status: resolved
created: 2026-05-29
updated: 2026-05-29
assignee: ""
tags: [convention, error-handling, channels]
---

# ChannelCatalog throws plain Error instead of custom error class

## Description

`ChannelCatalog.ts` line 49 throws a plain `Error` instead of the project's custom `NotFoundError`. This is inconsistent with the error handling convention where all controllers and services use typed error classes from `src/errors.ts`.

## Steps to Reproduce

1. Request a channel type that doesn't exist via `getChannelByType()`
2. Plain `Error` is thrown instead of `NotFoundError`

## Expected Behavior

`NotFoundError` should be thrown for missing channel types.

## Actual Behavior

Plain `Error` is thrown, making it indistinguishable from unexpected errors in the global handler.

## Notes

File: `src/channels/ChannelCatalog.ts`
