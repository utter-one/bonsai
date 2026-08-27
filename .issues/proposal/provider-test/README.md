# Provider connection testing — issue index

On-demand "test connection" for every provider type, exercising the
provider's **own communication protocol** (same code path as the main
functionality) to verify authentication and availability.

Proposal: [`PROPOSAL-provider-test-connection.md`](../../PROPOSAL-provider-test-connection.md)

## Specs

| ID | Title | Phase | Est. | Status |
|---|---|---|---|---|
| [TPC-01](TPC-01-tester-core.md) | Tester core: types, dispatch, guards, instance construction | 1 | 1 d | resolved |
| [TPC-02](TPC-02-llm-strategy.md) | LLM test: 1-token real inference | 1 | 0.5 d | resolved |
| [TPC-03](TPC-03-asr-strategy.md) | ASR test: real WS session + silence | 1 | 1 d | resolved |
| [TPC-04](TPC-04-tts-strategy.md) | TTS test: real minimal synthesis | 1 | 0.5 d | resolved |
| [TPC-05](TPC-05-storage-strategy.md) | Storage test: list + optional write round trip | 1 | 0.5 d | resolved |
| [TPC-06](TPC-06-http-endpoint-rbac.md) | HTTP endpoint, contracts, RBAC, audit | 2 | 1 d | resolved |
| [TPC-07](TPC-07-call-log-integration.md) | Call-log integration + alert interplay + docs | 2 | 0.5–1 d | open |
| [TPC-08](TPC-08-channel-providers.md) | Channel strategies: same-protocol auth checks | 3 | 1 d | open |
| [TPC-09](TPC-09-periodic-data-plane-probes.md) | (Optional) Opt-in periodic data-plane probes | 3 | 1 d | open |

Total: ~7–8 dev-days (TPC-09 optional).

## Dependency graph

Arrows list **direct dependencies only** (transitive ones follow by
construction).

```
TPC-01  (no new dependencies)
TPC-02  ◄── TPC-01
TPC-03  ◄── TPC-01
TPC-04  ◄── TPC-01
TPC-05  ◄── TPC-01
TPC-06  ◄── TPC-01, TPC-02, TPC-05
TPC-07  ◄── TPC-01
TPC-08  ◄── TPC-01, TPC-06
TPC-09  ◄── TPC-03, TPC-04, TPC-07   (optional)
```

## Phases

1. **Core tester** — TPC-01…05 (per-type tests ship independently once the
   core lands).
2. **API + monitoring integration** — TPC-06 + TPC-07 (the feature is
   end-to-end: endpoint, RBAC, audit, call-log/last-signal interplay).
3. **Extensions** — TPC-08 (channels), TPC-09 (optional periodic
   data-plane probes).

Each spec is independently testable and shippable within its phase.

## Architecture note (2026-08-26, refinement)

TPC-01…05 shipped first with a **per-type strategy module** per
`providerType` (`connectionTest/strategies/{llm,asr,tts,storage}.ts` + a
`Map<providerType, strategy>` registry + a `ConnectionTestStrategy`
interface). That design was then **refactored (user-directed)**: the
strategy modules were removed and the **provider base classes now own the
simple per-type test** via a `testConnection()` method
(`LlmProviderBase` / `AsrProviderBase` / `TtsProviderBase` /
`StorageProviderBase`). The `ProviderConnectionTester` dispatches by
`providerType` → resolves that type's factory → `createForTest()` → the
instance's own `testConnection()`. The tester keeps **all** cross-cutting
guards (cooldown, hard timeout, fresh instance, draft handling, monitoring
context, breaker exclusion, bounded cleanup, classification, sanitization,
and the public `providerType`/`apiType`/`protocol`/`latencyMs` from a
tester-owned protocol table); `ConnectionTestOutcome` is the
provider-produced fields only. Rationale + the cross-module-graph pitfalls
(dual-graph `instanceof`, the draft "hang" test, provider-scoped row
assertions) are documented in the TPC-01 Resolution section. The spec file
names keep the historical `*-strategy` suffix.
