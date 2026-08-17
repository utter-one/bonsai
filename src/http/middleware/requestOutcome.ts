import type { Request, Response, NextFunction } from 'express';
import logger from '../../utils/logger';
import { generateId, ID_PREFIXES } from '../../utils/idGenerator';
import { getMetricsRegistry } from '../../services/monitoring/ProviderCallRecorder';

// Extend Express Request type to include the request id
declare global {
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}

const REQUEST_ID_HEADER = 'X-Request-Id';
const MAX_INBOUND_REQUEST_ID_LENGTH = 128;

/** Paths excluded from metrics and outcome/incoming logs (probe/scrape traffic — P1-04 requirement 4). */
const SKIPPED_PATHS = new Set(['/health', '/metrics']);

/**
 * Request-outcome middleware (P1-04):
 * - assigns `req.id` (honoring an inbound `X-Request-Id` header when sane) and echoes it back
 * - on response finish: records `api_requests_total{method, route_group, status_class}` +
 *   `api_request_duration_ms{method, route_group}` and logs one outcome line
 *   (error for 5xx, warn for 4xx, debug for 2xx/3xx)
 *
 * Registered before the incoming-request log line and the rate limiter, so the incoming log
 * carries the id and limiter rejections (429) are counted too.
 */
export function requestOutcomeMiddleware(req: Request, res: Response, next: NextFunction): void {
  req.id = resolveRequestHeaderId(req.get(REQUEST_ID_HEADER));
  res.setHeader(REQUEST_ID_HEADER, req.id);

  if (!isSkippedRequestPath(req.path)) {
    const startedAt = performance.now();
    res.on('finish', () => {
      const status = res.statusCode;
      const routeGroup = resolveRouteGroup(req);
      const durationMs = Math.round((performance.now() - startedAt) * 100) / 100;
      const registry = getMetricsRegistry();
      registry?.inc('api_requests_total', { method: req.method, route_group: routeGroup, status_class: statusClass(status) });
      registry?.observe('api_request_duration_ms', { method: req.method, route_group: routeGroup }, performance.now() - startedAt);

      const fields = {
        requestId: req.id,
        method: req.method,
        route: routeGroup,
        status,
        durationMs,
        operatorId: req.context?.operatorId,
      };
      const level = resolveOutcomeLevel(status);
      if (level === 'error') {
        logger.error(fields, 'Request outcome');
      } else if (level === 'warn') {
        logger.warn(fields, 'Request outcome');
      } else {
        logger.debug(fields, 'Request outcome');
      }
    });
  }

  next();
}

/** Whether the path is probe/scrape traffic excluded from metrics and logs. */
export function isSkippedRequestPath(path: string): boolean {
  return SKIPPED_PATHS.has(path);
}

/** Honors the inbound id only when non-empty and length-bounded; otherwise generates a house-style id. */
export function resolveRequestHeaderId(value: string | undefined): string {
  const trimmed = value?.trim();
  if (trimmed && trimmed.length <= MAX_INBOUND_REQUEST_ID_LENGTH) return trimmed;
  return generateId(ID_PREFIXES.REQUEST);
}

/** Outcome log level: error for 5xx, warn for 4xx, debug for 2xx/3xx. */
export function resolveOutcomeLevel(status: number): 'debug' | 'warn' | 'error' {
  if (status >= 500) return 'error';
  if (status >= 400) return 'warn';
  return 'debug';
}

/** Coarse HTTP status class label: 2xx|3xx|4xx|5xx (anything outside 200-599 clamps to the nearest class). */
export function statusClass(status: number): string {
  const hundreds = Math.floor(status / 100);
  const clamped = Math.min(5, Math.max(2, hundreds));
  return `${clamped}xx`;
}

/**
 * Normalized route group for the `route_group` label:
 * - matched express route → its pattern (`req.baseUrl + req.route.path`, e.g. `/api/conversations/:id`)
 * - unmatched (404, rate-limiter rejection) → first two path segments (e.g. `/api/conversations`)
 * The registry's capped label + maxSeries keep cardinality bounded.
 */
export function resolveRouteGroup(req: Request): string {
  const route = req.route;
  if (route?.path) return req.baseUrl + route.path;
  const segments = req.path.split('/').filter(Boolean).slice(0, 2);
  return segments.length > 0 ? `/${segments.join('/')}` : '/';
}
