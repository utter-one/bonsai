import type { Request, Response } from 'express';
import type { RequestContext } from '../../src/services/RequestContext';

/** Options for creating a mock Express Request */
export interface MockRequestOptions {
  params?: Record<string, string>;
  body?: Record<string, any>;
  query?: Record<string, any>;
  user?: { operatorId: string; roles: string[] } | undefined;
  context?: RequestContext | undefined;
}

/** Create a minimal mock Express Request */
export function createMockRequest(options: MockRequestOptions = {}): Request {
  return {
    params: options.params ?? {},
    body: options.body ?? {},
    query: options.query ?? {},
    user: options.user,
    context: options.context,
    ip: '127.0.0.1',
    get: vi.fn().mockReturnValue(''),
  } as unknown as Request;
}

/** Mock Response with chained status/json/send tracking */
export interface MockResponse {
  statusCode: number | undefined;
  jsonBody: unknown;
  sent: boolean;
  status: (code: number) => { json: (body: any) => MockResponse; send: () => MockResponse };
  json: (body: any) => MockResponse;
  send: () => MockResponse;
}

export function createMockResponse(): MockResponse {
  const state = {
    statusCode: undefined as number | undefined,
    jsonBody: undefined as unknown,
    sent: false,
  };

  const result: MockResponse = {
    get statusCode() { return state.statusCode; },
    get jsonBody() { return state.jsonBody; },
    get sent() { return state.sent; },
    status: (code: number) => {
      state.statusCode = code;
      return {
        json: (body: any) => {
          state.jsonBody = body;
          return result;
        },
        send: () => {
          state.sent = true;
          return result;
        },
      };
    },
    json: (body: any) => {
      state.jsonBody = body;
      return result;
    },
    send: () => {
      state.sent = true;
      return result;
    },
  };

  return result;
}
