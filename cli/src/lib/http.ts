import { CliConfig } from './config.js';

export interface HttpRequestInit {
  method: string;
  baseUrl: string;
  pathTemplate: string;
  pathParams: Record<string, string>;
  queryParams?: Record<string, string | number | boolean | string[]>;
  body?: unknown;
  timeout: number;
  token: string | null;
}

export interface HttpClient {
  get: (path: string, queryParams?: Record<string, string | number | boolean | string[]>) => Promise<unknown>;
  post: (path: string, body?: unknown, queryParams?: Record<string, string | number | boolean | string[]>) => Promise<unknown>;
  put: (path: string, body?: unknown, queryParams?: Record<string, string | number | boolean | string[]>) => Promise<unknown>;
  delete: (path: string, queryParams?: Record<string, string | number | boolean | string[]>) => Promise<unknown>;
}

export function createHttpClient(config: CliConfig): HttpClient {
  const baseUrl = config.baseUrl || process.env.BONSAI_API_BASE_URL || 'http://localhost:3000';

  async function call(method: string, path: string, body?: unknown, queryParams?: Record<string, string | number | boolean | string[]>): Promise<unknown> {
    const result = await request({
      method,
      baseUrl,
      pathTemplate: path,
      pathParams: {},
      queryParams,
      body,
      timeout: config.timeout,
      token: config.token,
    });

    if (result.status >= 400) {
      const error = new Error(result.data as string) as Error & { status: number; body: unknown };
      error.status = result.status;
      error.body = result.data;
      throw error;
    }

    return result.data;
  }

  return {
    get: (path, queryParams) => call('get', path, undefined, queryParams),
    post: (path, body, queryParams) => call('post', path, body, queryParams),
    put: (path, body, queryParams) => call('put', path, body, queryParams),
    delete: (path, queryParams) => call('delete', path, undefined, queryParams),
  };
}

export function buildUrl(baseUrl: string, pathTemplate: string, pathParams: Record<string, string>): string {
  let path = pathTemplate;
  for (const [key, value] of Object.entries(pathParams)) {
    path = path.replace(`{${key}}`, encodeURIComponent(value));
  }
  return `${baseUrl.replace(/\/+$/, '')}${path}`;
}

export function buildQueryString(params: Record<string, string | number | boolean | string[]>): string {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      searchParams.set(key, value.join(','));
    } else if (typeof value === 'boolean') {
      searchParams.set(key, String(value));
    } else {
      searchParams.set(key, String(value));
    }
  }

  const qs = searchParams.toString();
  return qs ? `?${qs}` : '';
}

export async function request(options: HttpRequestInit): Promise<{ status: number; headers: Headers; data: unknown }> {
  const { method, baseUrl, pathTemplate, pathParams, queryParams, body, timeout, token } = options;

  const url = buildUrl(baseUrl, pathTemplate, pathParams) + buildQueryString(queryParams || {});

  const headers: Record<string, string> = {
    'Accept': 'application/json',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (body !== undefined && body !== null) {
    headers['Content-Type'] = 'application/json';
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      method: method.toUpperCase(),
      headers,
      body: body !== undefined && body !== null ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    let data: unknown = null;
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      data = await response.json();
    } else if (response.status !== 204) {
      data = await response.text();
    }

    return {
      status: response.status,
      headers: response.headers,
      data,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
