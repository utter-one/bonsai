/**
 * Shared helper for the optional `ping()` liveness probes (P1-05b).
 *
 * Performs a zero-cost GET against a vendor list/info endpoint and classifies
 * the outcome: network errors and non-2xx responses reject with a descriptive
 * Error (the HTTP status is in the message); 2xx resolves. Provider `ping()`
 * implementations wrap this in their base-class `recordPingCall()` so each
 * probe lands exactly one row in `provider_call_logs`.
 */
export async function httpPing(url: string, headers: Record<string, string>): Promise<void> {
  const res = await fetch(url, { method: 'GET', headers });
  if (!res.ok) {
    throw new Error(`Liveness probe failed: HTTP ${res.status} from ${url}`);
  }
}
