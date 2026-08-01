import { loadConfig } from './config.js';
import { request } from './http.js';
import { successEnvelope, errorEnvelope, printEnvelope, Envelope } from './output.js';
import { translateServerError, getExitCode } from './errors.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BONSAI_CONFIG_PATH } from './constants.js';

export interface OperationConfig {
  method: string;
  pathTemplate: string;
  scope: 'global' | 'project';
  action: string;
  pathParamNames: string[];
  queryParamNames: string[];
  repeatableParams: string[];
  bodySchemaRef?: string | null;
  isPaginated?: boolean;
}

interface RunOptions {
  json: boolean;
  verbose: boolean;
  [key: string]: unknown;
}

async function refreshToken(config: any): Promise<string | null> {
  if (!config.refreshToken) return null;

  try {
    const resp = await request({
      method: 'post',
      baseUrl: config.baseUrl,
      pathTemplate: '/api/auth/refresh',
      pathParams: {},
      body: { refreshToken: config.refreshToken },
      timeout: config.timeout,
      token: null,
    });

    if (resp.status >= 400) return null;

    const data = resp.data as Record<string, unknown>;
    const newToken = data.accessToken as string;
    const newRefreshToken = data.refreshToken as string;

    const envPath = process.env.BONSAI_CONFIG_PATH;
    const configPath = envPath || resolve(BONSAI_CONFIG_PATH);

    try {
      const raw = readFileSync(configPath, 'utf-8');
      const fileConfig = JSON.parse(raw);
      fileConfig.token = newToken;
      fileConfig.refreshToken = newRefreshToken;
      writeFileSync(configPath, JSON.stringify(fileConfig, null, 2), 'utf-8');
    } catch {
      // Config file write failed, but we can still use the new token
    }

    return newToken;
  } catch {
    return null;
  }
}

export async function runOperation(op: OperationConfig, options: RunOptions): Promise<number> {
  const startTime = Date.now();
  const cmd = options as any;
  const opts = cmd._optionValues || cmd;
  const config = await loadConfig({
    baseUrl: opts.baseUrl as string | undefined,
    project: opts.project as string | undefined,
    token: opts.token as string | undefined,
  });

  if (!config.baseUrl) {
    const env = errorEnvelope('CONFIG_ERROR', 'No API base URL configured. Set --base-url, BONSAI_API_BASE_URL, or configure via `bonsai config set`.', 1);
    printEnvelope(env, opts.json);
    return 2;
  }

  if (!config.token) {
    const env = errorEnvelope('UNAUTHORIZED', 'No authentication token. Set --token, BONSAI_API_TOKEN, or run `bonsai auth login`.', 401);
    printEnvelope(env, opts.json);
    return 3;
  }

  if (op.scope === 'project' && !config.project) {
    const env = errorEnvelope('MISSING_PROJECT', 'No project ID. Set --project, BONSAI_PROJECT_ID, or configure default.', 400);
    printEnvelope(env, opts.json);
    return 2;
  }

  const pathParams: Record<string, string> = {};
  if (op.scope === 'project') {
    pathParams.projectId = config.project!;
  }
  for (const name of op.pathParamNames) {
    const value = opts[name];
    if (value === undefined || value === null) {
      const env = errorEnvelope('MISSING_ARG', `Missing required parameter: ${name}`, 400);
      printEnvelope(env, opts.json);
      return 2;
    }
    pathParams[name] = String(value);
  }

  const queryParams: Record<string, string | number | boolean | string[]> = {};
  for (const name of op.queryParamNames) {
    const value = opts[name];
    if (value !== undefined && value !== null && value !== '') {
      queryParams[name] = value as string | number | boolean | string[];
    }
  }

  let body: unknown = undefined;
  if (opts.data !== undefined && opts.data !== null && opts.data !== '') {
    if (typeof opts.data === 'string') {
      if (opts.data === '-') {
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) {
          chunks.push(chunk);
        }
        body = JSON.parse(Buffer.concat(chunks).toString());
      } else {
        body = JSON.parse(opts.data);
      }
    }
  } else if (opts.dataFile) {
    const { readFileSync } = await import('node:fs');
    body = JSON.parse(readFileSync(opts.dataFile as string, 'utf-8'));
  } else {
    const excludedKeys = new Set([
      'json', 'verbose', 'quiet', 'project', 'token', 'baseUrl', 'timeout',
      'data', 'dataFile', 'help', 'noHelp', 'paginate', 'jsonSchema',
      'version',
      'search', 'order', 'filter',
    ]);
    const fieldKeys = Object.keys(opts).filter(k =>
      !excludedKeys.has(k) &&
      !op.pathParamNames.includes(k) &&
      !op.queryParamNames.includes(k) &&
      typeof opts[k] !== 'object'
    );
    if (fieldKeys.length > 0) {
      body = {};
      for (const key of fieldKeys) {
        const value = opts[key];
        if (value !== undefined && value !== null) {
          (body as Record<string, unknown>)[key] = value;
        }
      }
    }
  }

  try {
    let resp = await request({
      method: op.method,
      baseUrl: config.baseUrl,
      pathTemplate: op.pathTemplate,
      pathParams,
      queryParams,
      body,
      timeout: config.timeout,
      token: config.token,
    });

    // Auto-refresh token on 401
    if (resp.status === 401 && config.refreshToken) {
      const newToken = await refreshToken(config);
      if (newToken) {
        resp = await request({
          method: op.method,
          baseUrl: config.baseUrl,
          pathTemplate: op.pathTemplate,
          pathParams,
          queryParams,
          body,
          timeout: config.timeout,
          token: newToken,
        });
      }
    }

    if (opts.verbose) {
      process.stderr.write(`[verbose] ${op.method} ${op.pathTemplate} → ${resp.status} (${Date.now() - startTime}ms)\n`);
    }

    if (resp.status >= 400) {
      const env = translateServerError(resp.status, resp.data);
      printEnvelope(env, opts.json);
      return getExitCode(env.error.code);
    }

    // Handle pagination
    if (op.isPaginated && opts.paginate) {
      const allItems: unknown[] = [];
      let currentData = resp.data as Record<string, unknown> | unknown[] | null;

      if (Array.isArray(currentData)) {
        allItems.push(...currentData);
      } else if (currentData && typeof currentData === 'object' && 'items' in currentData) {
        const items = (currentData as Record<string, unknown>).items;
        if (Array.isArray(items)) {
          allItems.push(...items);
        }
      }

      let offset = Number(queryParams.offset || 0);
      const limit = Number(queryParams.limit || 100);

      while (allItems.length > offset) {
        offset += limit;
        const pageQueryParams = { ...queryParams, offset };

        const pageResp = await request({
          method: op.method,
          baseUrl: config.baseUrl,
          pathTemplate: op.pathTemplate,
          pathParams,
          queryParams: pageQueryParams,
          body,
          timeout: config.timeout,
          token: config.token,
        });

        if (pageResp.status >= 400) break;

        const pageData = pageResp.data as Record<string, unknown> | unknown[] | null;

        if (Array.isArray(pageData)) {
          if (pageData.length === 0) break;
          allItems.push(...pageData);
        } else if (pageData && typeof pageData === 'object' && 'items' in pageData) {
          const items = (pageData as Record<string, unknown>).items;
          if (Array.isArray(items) && items.length === 0) break;
          if (Array.isArray(items)) {
            allItems.push(...items);
          }
        } else {
          break;
        }
      }

      const envelope: Envelope = successEnvelope(allItems, {
        duration_ms: Date.now() - startTime,
        paginated: true,
        totalItems: allItems.length,
      });
      printEnvelope(envelope, opts.json);
      return 0;
    }

    let data = resp.data ?? null;
    let meta: Record<string, unknown> = { duration_ms: Date.now() - startTime };

    if (op.isPaginated && data && typeof data === 'object' && !Array.isArray(data)) {
      const respData = data as Record<string, unknown>;
      if ('items' in respData) {
        data = respData.items as Record<string, unknown> | null;
        meta.pagination = {
          offset: respData.offset,
          limit: respData.limit,
          total: respData.total,
        };
      }
    }

    const envelope: Envelope = successEnvelope(data, meta);
    printEnvelope(envelope, opts.json);
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const env = errorEnvelope('NETWORK_ERROR', message, 0);
    printEnvelope(env, opts.json);
    return 8;
  }
}
