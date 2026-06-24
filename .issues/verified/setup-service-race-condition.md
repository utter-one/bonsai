---
title: "SetupService race condition and duplicate operator creation"
severity: high
status: resolved
created: 2026-05-29
updated: 2026-05-31
assignee: ""
tags: [security, race-condition]
---

# SetupService race condition and duplicate operator creation

## Description

Multiple HIGH issues in `SetupService.ts`:

1. **Line 25/52**: `findMany({ limit: 1 })` semantically wrong for existence check.
2. **Line 52-63**: Race condition. Concurrent requests can create duplicate operators.

## Steps to Reproduce

1. Send concurrent POST requests to /api/setup/initial-operator
2. Observe duplicate operators created

## Expected Behavior

Atomic existence check and creation. Only one operator should be creatable.

## Actual Behavior

Race window allows duplicate operators.

## Notes

File: `src/services/SetupService.ts`
