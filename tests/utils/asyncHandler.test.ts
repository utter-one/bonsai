import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { asyncHandler } from '../../src/utils/asyncHandler';

describe('asyncHandler', () => {
  const mockReq = {} as Request;
  const mockRes = {} as Response;

  it('calls the wrapped handler successfully', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const next = vi.fn();
    const wrapped = asyncHandler(handler);

    await wrapped(mockReq, mockRes, next);

    expect(handler).toHaveBeenCalledWith(mockReq, mockRes, next);
    expect(next).not.toHaveBeenCalled();
  });

  it('passes synchronous errors thrown by the wrapper to next', () => {
    const err = new Error('sync error');
    const handler = vi.fn().mockImplementation(() => { throw err; });
    const next = vi.fn();
    const wrapped = asyncHandler(handler);

    expect(() => wrapped(mockReq, mockRes, next)).toThrow(err);
    expect(next).not.toHaveBeenCalled();
  });

  it('passes asynchronous errors to next', async () => {
    const err = new Error('async error');
    const handler = vi.fn().mockRejectedValue(err);
    const next = vi.fn();
    const wrapped = asyncHandler(handler);

    await wrapped(mockReq, mockRes, next);

    expect(next).toHaveBeenCalledWith(err);
  });

  it('does not call next on success', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const next = vi.fn();
    const wrapped = asyncHandler(handler);

    await wrapped(mockReq, mockRes, next);

    expect(next).not.toHaveBeenCalled();
  });

  it('handles non-Error rejections', async () => {
    const handler = vi.fn().mockRejectedValue('string error');
    const next = vi.fn();
    const wrapped = asyncHandler(handler);

    await wrapped(mockReq, mockRes, next);

    expect(next).toHaveBeenCalledWith('string error');
  });
});
