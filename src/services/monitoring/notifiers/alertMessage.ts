/**
 * P4-02 — shared plain-text alert formatter for the messaging notifiers
 * (telegram / twilio_sms / whatsapp).
 *
 * Plain text on purpose: `event.message` is free-form (rule-generated error
 * summaries can contain `<`, `>`, `&`, markdown-like fragments), so no
 * channel markup/parse mode is used — the severity emoji conveys the level
 * (spec finding 5).
 */

import type { AlertEvent } from '../AlertEventPublisher';
import type { AlertPhase } from './AlertNotifier';

/** Severity → emoji (fired phase). Resolved always uses `RESOLVED_EMOJI`. */
const SEVERITY_EMOJI: Record<string, string> = {
  critical: '🚨',
  warning: '⚠️',
  info: 'ℹ️',
};

const RESOLVED_EMOJI = '✅';
const TRUNCATION_SUFFIX = '…(truncated)';

/**
 * Builds the single-line-header alert text:
 *
 * ```
 * 🚨 Bonsai alert: provider-down — provider-down:prov_123
 * <event.message>
 * fired: 2026-08-19T12:00:00.000Z
 * ```
 *
 * Resolved phase: `✅ Bonsai resolved: …` + `fired: … / resolved: …` footer.
 * Truncation keeps the header intact and cuts the message line to fit
 * `maxChars` (channel limit minus headroom), appending `…(truncated)`.
 */
export function buildAlertText(event: AlertEvent, phase: AlertPhase, maxChars: number): string {
  const emoji = phase === 'resolved' ? RESOLVED_EMOJI : (SEVERITY_EMOJI[event.severity] ?? 'ℹ️');
  const header = `${emoji} Bonsai ${phase === 'resolved' ? 'resolved' : 'alert'}: ${event.ruleId} — ${event.scopeKey}`;
  const footer =
    phase === 'resolved'
      ? `fired: ${event.firedAt.toISOString()} / resolved: ${event.resolvedAt ? event.resolvedAt.toISOString() : 'unknown'}`
      : `fired: ${event.firedAt.toISOString()}`;

  const budget = Math.max(0, maxChars - header.length - footer.length - 2); // 2 newlines
  const message =
    event.message.length > budget
      ? `${event.message.slice(0, Math.max(0, budget - TRUNCATION_SUFFIX.length))}${TRUNCATION_SUFFIX}`
      : event.message;

  return `${header}\n${message}\n${footer}`;
}
