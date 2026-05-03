import type { AuditService } from '../src/services/AuditService';

export function createMockAuditService(): Partial<AuditService> & Record<string, ReturnType<typeof vi.fn>> {
  return {
    logChange: vi.fn().mockResolvedValue({} as any),
    logCreate: vi.fn().mockResolvedValue({} as any),
    logUpdate: vi.fn().mockResolvedValue({} as any),
    logDelete: vi.fn().mockResolvedValue({} as any),
    getEntityAuditLogs: vi.fn().mockResolvedValue([]),
    getUserAuditLogs: vi.fn().mockResolvedValue([]),
    listAuditLogs: vi.fn().mockResolvedValue({ items: [], total: 0, offset: 0, limit: null }),
  };
}
