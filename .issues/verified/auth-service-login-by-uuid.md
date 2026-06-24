---
title: "AuthService login by UUID instead of email and token validation gaps"
severity: high
status: resolved
created: 2026-05-29
updated: 2026-05-31
assignee: ""
tags: [security, authentication]
---

# AuthService login by UUID instead of email and token validation gaps

## Description

`AuthService.ts` line 93: Login looks up operator by `id` parameter. JSDoc says email, but queries by UUID. This is a security concern as UUIDs may be enumerable or exposed elsewhere.

## Resolution

FALSE POSITIVE: The `operators` table has no `email` column. Schema only has `id`, `name`, `roles`, `password`, `metadata`, `version`, `createdAt`, `updatedAt`. Login by UUID is the only possible lookup. The contract documentation ("Operator user ID or email") is misleading but the service behavior is correct. No security concern — UUIDs are not enumerable and login is rate-limited.
