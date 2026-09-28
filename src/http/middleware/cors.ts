import cors from 'cors';
import type { CorsOptions } from 'cors';

/**
 * Parses the `CORS_ORIGIN` env var — a comma-separated list of allowed origins
 * (e.g. `http://localhost:5173,https://console.example.com`).
 *
 * Returns `null` when the variable is unset/blank — that is the default mode,
 * where every request's origin is echoed back (see `resolveCorsOrigin`).
 */
export function parseCorsOriginEnv(raw: string | undefined): string[] | null {
  if (!raw) return null;
  const origins = raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  return origins.length > 0 ? origins : null;
}

/**
 * Pure origin resolver (unit-tested separately from the `cors` package):
 * - no Origin header (non-browser client such as curl/CLI): `true` — nothing to restrict
 * - configured allowlist: exact match → echo the origin (credentials-compatible);
 *   mismatch → `false` (no CORS headers are emitted, the browser blocks the request)
 * - no allowlist (default): echo the request's origin. This behaves like `*` for
 *   non-credentialed clients but, unlike a literal `*`, also works with
 *   `credentials: 'include'` — browsers reject `Access-Control-Allow-Origin: *`
 *   when credentials are in use, which is what broke localhost dev frontends.
 */
export function resolveCorsOrigin(requestOrigin: string | undefined, allowedOrigins: string[] | null): string | true | false {
  if (!requestOrigin) return true;
  if (allowedOrigins) {
    return allowedOrigins.includes(requestOrigin) ? requestOrigin : false;
  }
  return requestOrigin;
}

/**
 * Options for the `cors` package. `corsOptions()` reads `CORS_ORIGIN` at call
 * time (i.e. at app creation), so test env vars set before `createApp()` apply.
 *
 * `X-Request-Id` is allowed in preflight (the frontend may set it per request
 * for log correlation, P1-04) and exposed on responses so browser JS can read
 * it back, along with `Retry-After` and the `RateLimit-*` headers.
 */
export function corsOptions(corsOriginEnv: string | undefined = process.env.CORS_ORIGIN): CorsOptions {
  const allowedOrigins = parseCorsOriginEnv(corsOriginEnv);
  return {
    origin: (origin, callback) => {
      callback(null, resolveCorsOrigin(origin, allowedOrigins));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id', 'Retry-After', 'RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset'],
  };
}
