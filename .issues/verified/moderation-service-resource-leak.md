---
title: "ModerationService resource exhaustion and fragile error detection"
severity: high
status: resolved
created: 2026-05-29
updated: 2026-05-31
assignee: ""
tags: [resource-leak, error-handling]
---

# ModerationService resource exhaustion and fragile error detection

## Description

Multiple HIGH issues in `ModerationService.ts`:

1. **Line 53-54**: Provider created/initialized every call. No caching. Resource exhaustion risk.
2. **Line 53-69**: Provider never cleaned up. Resource leak.
3. **Line 63**: Error detection via `message.includes('not sensitive')`. Fragile.

## Steps to Reproduce

1. Call moderateUserInput repeatedly
2. Observe new provider created each time, never cleaned up

## Expected Behavior

Provider should be cached and reused. Proper error handling.

## Actual Behavior

New provider per call. No cleanup. Fragile string matching for errors.

## Notes

File: `src/services/ModerationService.ts`
