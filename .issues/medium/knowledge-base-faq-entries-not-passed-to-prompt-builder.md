---
title: "Knowledge base FAQ entries not passed to prompt builder"
severity: medium
status: resolved
created: 2026-06-01
updated: 2026-06-01
assignee: ""
tags: [misconfiguration, knowledge-base]
---

# Knowledge base FAQ entries not passed to prompt builder

## Description

Knowledge base related answers are not being retrieved. A quick investigation using `console.log()` showed that no FAQ entries were going to the prompt builder/renderer. The root cause was not identified.

## Steps to Reproduce

1. Set up a project with knowledge base FAQ entries
2. Trigger a conversation that should use knowledge base answers
3. Observe that no FAQ entries reach the prompt builder

## Expected Behavior

FAQ entries from the knowledge base are included in the prompt builder/renderer.

## Actual Behavior

No FAQ entries are passed to the prompt builder/renderer.

## Notes

Likely a project misconfiguration: the stage prompt template is missing `{{faq}}` placeholders. The `faq` variable is available in the context at `buildContextForUserInput` (`src/services/live/ConversationContextBuilder.ts:1088`), but if the prompt template doesn't reference it, FAQ items are silently ignored. No code change needed — the user needs to add `{{faq}}` to their stage prompt template.
