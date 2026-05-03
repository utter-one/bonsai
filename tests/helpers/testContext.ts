import type { RequestContext } from '../src/services/RequestContext';

export interface RequestContextFactoryOptions {
  operatorId?: string;
  roles?: string[];
  ip?: string;
  userAgent?: string;
  requestId?: string;
  timestamp?: Date;
}

export function createTestContext(options: RequestContextFactoryOptions = {}): RequestContext {
  return {
    operatorId: options.operatorId ?? 'oper_test-operator-id',
    roles: options.roles ?? ['super_admin'],
    ip: options.ip ?? '127.0.0.1',
    userAgent: options.userAgent ?? 'test-agent/1.0',
    requestId: options.requestId ?? 'req_test-request-id',
    timestamp: options.timestamp ?? new Date(),
  };
}

export function createTestContextWithRoles(roles: string[]): RequestContext {
  return createTestContext({ roles });
}

export function createUnauthorizedContext(): undefined {
  return undefined;
}
