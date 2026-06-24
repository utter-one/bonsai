---
title: "VersionService undefined git commit and non-deterministic hash"
severity: high
status: resolved
created: 2026-05-29
updated: 2026-05-31
assignee: ""
tags: [data-integrity]
---

# VersionService undefined git commit and non-deterministic hash

## Description

`VersionService.ts` line 58: `gitCommit` resolves to `undefined`. Type expects `string | null`. This produces incorrect version information.

## Steps to Reproduce

1. Call getVersionInfo
2. Observe gitCommit is undefined instead of string/null

## Expected Behavior

gitCommit should be a valid string or null.

## Actual Behavior

Resolves to undefined, violating declared type.

## Notes

File: `src/services/VersionService.ts`
