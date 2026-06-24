---
title: "Removing benchmark suite does not cascade delete related entities"
severity: medium
status: open
created: 2026-06-01
updated: 2026-06-01
assignee: ""
tags: [bug, data-integrity]
---

# Removing benchmark suite does not cascade delete related entities

## Description

Removing a benchmark suite throws an error because related entities (configs, runs) are not cascade deleted. This leaves orphaned records or prevents deletion entirely.

## Steps to Reproduce

1. Create a benchmark suite with associated configs and runs
2. Attempt to delete the benchmark suite
3. Observe the error

## Expected Behavior

The benchmark suite and all related entities (configs, runs) are deleted cleanly via cascade delete.

## Actual Behavior

An error is thrown because related entities block the deletion.

## Notes

Two-part fix needed:
1. Add cascade delete in the backend for related entities
2. Add a warning on the client-side before deletion
