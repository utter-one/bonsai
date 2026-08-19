---
title: "P2-02 — Alert notifiers (webhook, email via channel provider)"
severity: proposal
status: resolved
created: 2026-08-17
updated: 2026-08-19
assignee: ""
tags: [monitoring, spec, phase-2]
---

# P2-02 — Alert notifiers (webhook, email via channel provider)

- **Phase:** 2 — Alerting
- **Depends on:** P2-01 (publisher seam), P1-06 (config)
- **Blocks:** P2-03 (notification visibility in API), P4-02
- **Estimate:** 1 dev-day

## Objective

Deliver alerts out of the process. Webhook first (works with Slack/Discord/PagerDuty/ntfy/Make out of the box), email second — reusing an existing channel provider record so **no new credentials are stored anywhere**.

## Scope

### New files
- `src/services/monitoring/notifiers/AlertNotifier.ts` — interface + `NotifyingPublisher` (wraps P2-01's `LogAndPersistPublisher`)
- `src/services/monitoring/notifiers/WebhookNotifier.ts`
- `src/services/monitoring/notifiers/EmailNotifier.ts`

### Modified files
- `src/server.ts` — register `NotifyingPublisher` (notifiers from config) as the active publisher on `ALERT_EVENT_PUBLISHER_TOKEN`
- `src/services/monitoring/MonitoringConfigService.ts` — `@injectable` → `@singleton` (finding 1) + `save()` ensures the row from the DB, not the cache
- `src/channels/email/shared/EmailConnectionBase.ts` — `sendEmail` protected → public (finding 3)
- `tests/utils.ts` — `resetDatabase()` reloads the shared monitoring config after truncate (finding 1)

(The spec originally listed `src/http/contracts/monitoring.ts` for the delivery-result type — `AlertNotification` already exists in `src/db/schema.ts` from P1-01 with the exact shape, so no contract change is needed — finding 7.)

## Implementation requirements

### Interface
```ts
interface AlertNotifier {
  readonly type: 'webhook' | 'email';
  deliver(event: AlertEvent, phase: 'fired' | 'resolved', config: NotifierConfig): Promise<{ ok: boolean; detail?: string }>;
}
```
(`config` param added in the P2-02 soundness review — finding 2.)
- `NotifyingPublisher`: on fire/resolve → persist (P2-01 behavior) then fan out **in parallel** to all **enabled** notifiers whose type matches an implemented notifier and whose event severity ≥ the notifier's `minSeverity` (default `info` = all severities). The notifier list is resolved from `MonitoringConfigService.get()` **on every delivery** — `PUT /config` changes take effect without a restart (requires the `@singleton` fix — finding 1). Per-notifier 10 s timeout per attempt, **1 retry** for webhook on transport failure only (connection refused / DNS / timeout); non-2xx responses are final. The publisher caps the whole fan-out at **15 s**: overrun → pino warn + not-yet-complete notifiers recorded as failed with detail `'incomplete: 15s publisher cap'` (finding 6). Delivery results appended to the `alert_events.notifications` jsonb: `[{ notifierId, phase, ok, detail?, at }]`.
- **Never throw, never block the engine**: notifier failures → pino error + recorded result. Alert history is complete even if every notifier is down (PROPOSAL risk §5).

### WebhookNotifier
- POST JSON to configured `url`: `{ event: 'alert_fired' | 'alert_resolved', ruleId, severity, scopeKey, scope, message, context, firedAt, resolvedAt? }`.
- Headers: `Content-Type: application/json`, `User-Agent: bonsai-backend-monitoring/1.0`. No auth header (the URL itself may carry a token — document that; never log the URL).
- Success = 2xx. Non-2xx → `{ ok: false, detail: 'HTTP ' + status }`.

### EmailNotifier
- Config: `channelProviderId` pointing at an existing `providers` row with `providerType='channel'` (sendgrid | ses | smtp-imap). Resolve config via `SecretRefUtils` (same path the channel hosts use) — no new secret storage.
- Reuse the existing connection classes' send methods directly (instantiate per delivery — they're lightweight; do **not** re-enter the channel host's conversation machinery — this is a raw email send, not a conversation). If a connection class doesn't expose a usable raw-send method, extract one into a small shared `src/channels/email/shared/EmailSender.ts` used by both (keep the extraction minimal).
- Subject: `[Bonsai][{SEVERITY}] {rule name} — {scopeKey}`; body: plain text `message` + context summary + firedAt/resolvedAt.
- `to` from notifier config (email address — P1-06's per-type `.refine` already enforces `to: email` + `channelProviderId` for email notifiers).

## Acceptance criteria

- [ ] Webhook: fired + resolved events received by a local HTTP test server with the documented payload shape; non-2xx and connection-refused cases recorded as failed deliveries without affecting the alert row.
- [ ] Email: with an SMTP channel provider fixture (test SMTP sink or mocked transporter), delivery attempt occurs and result is recorded; invalid `channelProviderId` (missing/wrong type) → delivery recorded as failed with a clear detail, pino error.
- [ ] Severity filtering (`minSeverity` = floor, not exact match): a notifier with `minSeverity: 'warning'` receives `warning` and `critical` events but **not** `info`; a `critical`-only-floor notifier receives only `critical`.
- [ ] `alert_events.notifications` always reflects actual delivery attempts (including failures).
- [ ] Engine latency unaffected: a 10 s-hanging webhook does not delay the next rule evaluation — the engine invokes `fire()` **without awaiting** inside the evaluation pass (unhandled-rejection-safe: `fire()` never throws), while the publisher itself awaits all notifiers with a 15 s overall cap before it completes (cap + pino warn on overrun).

## Tests

- **Unit:** notifier selection (enabled/severity filter), payload shape, retry-once-on-network-only logic, timeout cap. `NotifyingPublisher.appendResults` is `protected` so the unit suite uses a `RecordingPublisher` subclass override — no DB in unit tests. `EmailNotifier` has two seams (finding 8): `setProviderLoaderForTests` (replaces the providers table read — unit tests have no DB) and `setConnectionBuilderForTests` (replaces connection construction — the send itself never hits the network). The builder runs **after** schema validation, so invalid channel configs fail exactly like production.
- **E2E:** local webhook receiver (spin a tiny http server in the test) end-to-end via the engine; email with a fake `EmailConnectionBase` double injected through `setConnectionBuilderForTests` (finding 8) + `__TEST_ALERT_PUBLISHER__` global seam. Config is saved through the shared `@singleton` `MonitoringConfigService` (finding 1) — no engine config seam needed; the engine and the publisher read the same cache. Rule overrides are flat (`ruleOverrideSchema` fields directly under the rule id — no `params` wrapper).

## Out of scope

- Telegram/SMS notifiers (P4-02), per-rule notifier overrides (definitively **not** supported — the P1-06 schema reserves no hook; a later need is a separate config-shape change with its own spec; fan-out stays global-per-severity), notification dedup beyond cooldown (already in engine).

## Soundness review (2026-08-19)

Spec verified against the P1/P2-01 codebase before implementation. Findings (referenced inline as `finding N`):

1. **`MonitoringConfigService` is a per-instance cache — "no restart" pickup is false as written.** It is a plain `@injectable()` with a private cache: every injection point (engine, publisher, future P2-03 endpoint) gets a different instance that caches on first `get()` and never sees saves made through other instances. Fix: `@singleton()` (one shared cache; `save()`/`reload()` on the shared instance are visible to the engine and the publisher immediately). Consequences handled: (a) `tests/utils.ts resetDatabase()` truncates `monitoring_config`, so the shared cache is reloaded right after the truncate; (b) `save()` is hardened to ensure the row exists via a DB select + default-insert rather than trusting `get()`'s cache (cache-hit would otherwise skip the re-insert after a truncate).
2. **`deliver()` needs the notifier config.** The spec's two-arg signature cannot carry `url` / `to` / `channelProviderId`. Refinement: `deliver(event, phase, config)`. `NotifyingPublisher` holds one `WebhookNotifier` + one `EmailNotifier` (injected) and routes config entries by `type` — no per-entry notifier construction.
3. **`sendEmail` is `protected`.** The reusable raw-send path on `EmailConnectionBase` (P1-03 template wrapper) is `protected sendEmail(to, subject, body, attachments, headers?)`. Minimal fix: widen to `public`. The wrapper's `channel.send_message` call-log row is *desired*: alert-mail delivery failures then feed `provider_call_logs` → `provider-degraded`. The spec's fallback (`EmailSender.ts` extraction) is not needed — it would duplicate provider API calls.
4. **Per-type config parsing reuses exported schemas.** `sendGridChannelProviderConfigSchema` / `sesChannelProviderConfigSchema` / `smtpImapChannelProviderConfigSchema` are exported from `src/services/providers/channel/*ChannelProvider.ts` — exactly what the channel hosts use after `SecretRefUtils.resolveObject(provider.config)`. `EmailNotifier` keys off `providers.apiType` (`sendgrid` | `ses` | `smtp_imap`); anything else → failed delivery with a clear detail.
5. **Per-delivery connection construction is viable, including OAuth2 SMTP.** All three connection constructors need a `SessionManager` (DI `@singleton`) and a `subject` arg (the `doSendEmail` path uses the passed `to`/`subject` params, not the ctor fields). `SmtpImapConnection.ensureTransporter()` re-queries the providers row and self-refreshes the OAuth2 access token from config on send, so a per-delivery instance works as long as `OAuth2TokenRefreshService` keeps the DB token fresh.
6. **15 s cap vs 10 s per-notifier + retry.** A retried webhook can take ~20 s (2 × 10 s attempts), exceeding the 15 s publisher cap. Resolution: fan-out is parallel (`allSettled`); the 15 s cap races the whole fan-out; on overrun the not-yet-complete notifiers are recorded as `{ ok: false, detail: 'incomplete: 15s publisher cap' }` so `notifications` always reflects actual attempts. Webhook per-attempt timeout = `AbortSignal.timeout(10s)`; email (transporters have no abort API) = `Promise.race` abandonment + pino warn.
7. **Delivery-result type already exists.** `AlertNotification` is defined in `src/db/schema.ts` (P1-01) with the exact shape `{ notifierId, phase, ok, detail?, at }` — no `contracts/monitoring.ts` change needed.
8. **Email e2e stubbing needs a seam.** `EmailNotifier` constructs connections directly (per delivery, `new …`), so "stub via tsyringe override" cannot work. Test-only `EmailNotifier.setConnectionBuilderForTests(builder)` (default = real construction) + `__TEST_ALERT_PUBLISHER__` global seam in `tests/setup.ts` (app-world `NotifyingPublisher`, same pattern as `__TEST_ALERT_ENGINE__`). The double is an `EmailConnectionBase` subclass implementing `doSendEmail`.
9. **Webhook URL is never logged.** The URL may carry a token — pino lines include `notifierId` + status/detail only. (Spec said "document that"; it is a code comment + this finding.)
10. **Append semantics for `notifications`.** Read-modify-write of the jsonb by `event.id` (the engine generates the id before calling `fire()`, so no interface change). `fire` and `resolve` for the same row never overlap (engine passes are sequential; resolve only after ≥ N good passes), so no lost-update race in practice.
11. **Severity floor ordering.** `SEVERITY_RANK = { info: 0, warning: 1, critical: 2 }`; deliver when `rank(event.severity) >= rank(config.minSeverity ?? 'info')` — floor, not exact match.
12. **Email subject uses the rule id** (no human-facing rule names exist): `[Bonsai][CRITICAL] provider-down — provider-down:prov_123`. Body: plain-text message + context JSON (truncated to ~2 KB) + firedAt/resolvedAt.

## Implementation notes (2026-08-19)

1. **tsyringe token cache quirk — `__TEST_ALERT_PUBLISHER__` comes from the engine.** `container.resolve(ALERT_EVENT_PUBLISHER_TOKEN)` returns a *different* `NotifyingPublisher` than the one the engine holds (the string-token provider cache is separate from the `@singleton` class cache). `tests/setup.ts` therefore exposes `(engine as any).publisher` — the exact instance the engine invokes.
2. **Second email seam — `setProviderLoaderForTests`.** Unit tests have no database, so the providers table read is seam-able on its own; the connection builder then runs against a fake row + fake `SecretRefUtils`. `loadProvider` (row read + `providerType='channel'` validation) and the per-apiType schema parse run for real in both unit and e2e; only construction/send is faked in e2e.
3. **Engine state survives `resetDatabase()` in e2e.** The singleton engine's in-memory state machine (per-key status, cooldowns, good-streaks) is not truncated. Consequences handled in the suite: rule overrides set `cooldownMinutes: 0` (the 15 min default would block re-fires across tests), `afterEach` best-effort re-resolves `high-memory` (raise threshold + one `runNow()`), and the email test waits for its own send by subject (a leftover `provider-down` key resolving after the call rows are truncated legitimately emails the shared fake connection).
4. **`save()` returns `void`; the version lives on the row.** The e2e helper reads `monitoring_config.version` from the DB row to chain optimistic-lock versions (the `MonitoringConfig` type has no `version` field).
5. **Chai 6 + `JSON.stringify`:** the webhook payload's `resolvedAt: undefined` is stripped by `JSON.stringify`, so payload assertions use a key-less expected object + `to.not.have.property('resolvedAt')` (chai distinguishes missing keys from `undefined` values in `deep.equal`).
