---
title: "TPC-02 — LLM strategy: 1-token real inference"
severity: proposal
status: open
created: 2026-08-24
updated: 2026-08-24
assignee: ""
tags: [providers, spec, connection-test, phase-1, llm]
---

# TPC-02 — LLM connection strategy

- **Depends on:** TPC-01
- **Blocks:** TPC-06
- **Estimate:** 0.5 dev-day

## Objective

The `llm` strategy: verify auth + availability with a **1-token real
completion** through the production template wrapper — the same HTTP path,
headers, and streaming SSE a conversation uses.

## Scope

### New files

- `src/services/providers/connectionTest/strategies/llm.ts` (registered for
  `providerType 'llm'`)

## Implementation requirements

1. `generate([{ role: 'user', content: 'ping' }], { maxTokens: 1,
   temperature: 0 })` via the provider instance's production wrapper (same
   recording/timeout behavior as live calls, minus the breaker feed —
   TPC-01 guard).
2. **Model selection:** saved mode — `model` input param, defaulting to the
   first model from `enumerateModels()` (the existing free call, reused);
   draft mode — `model` **required** (`ValidationError` → 400).
3. All 16 apiTypes covered by construction (the factory already maps them:
   openai, openai-legacy, anthropic, gemini, groq, mistral, deepseek,
   openrouter, together-ai, fireworks-ai, perplexity, cohere, xai, ollama,
   ovh, scaleway) — no per-vendor code in the strategy.
4. `protocol: 'http'`; `phase: 'first-data'` on success; `detail: { model }`.
5. Why not `enumerateModels()` as the test: it is a *different endpoint*
   than inference (separate metering/limits; can work while inference quota
   is exhausted). `maxTokens: 1` is what conversations do — same rationale
   as `llmProbe: 'one_token'` in HealthCheckService. Cost: one output token.

## Acceptance criteria

- Diff of the strategy = existing method calls only (no protocol code).
- Every outcome class maps to the correct `errorCode` (below).

## Tests

**Unit** (`tests/unit/providers/connection-test-llm.test.ts`) — local fake
OpenAI-compatible HTTP server (no network):

- 200 (streamed) → `ok:true`, `phase 'first-data'`, `detail.model` set;
- 401 → `ok:false, errorCode 'auth'`;
- 429 → `rate_limited`; 500 → `server_error`;
- connection refused / DNS fail (dead `baseUrl`) → `network`;
- hang (no response) → `timeout` at 30 s (test uses a shortened timeout
  seam);
- saved mode without `model` → default model from a stubbed
  `enumerateModels()` is used.

## Out of scope

- Multi-model sweeps (existing benchmark suite), draft/endpoint plumbing
  (TPC-01/TPC-06).
