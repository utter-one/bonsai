import { describe, it, expect } from 'vitest';
import {
  OptimisticLockError,
  NotFoundError,
  InvalidOperationError,
  RemoteConnectionError,
  AccessDeniedError,
  UnauthorizedError,
  ForbiddenError,
  NotConfiguredError,
  ArchivedProjectError,
  ContentModerationError,
  TooManyRequestsError,
  UserBannedError,
  ConversationTerminatedError,
  ConflictError,
  ValidationError,
} from '../../src/errors';

describe('error classes', () => {
  const simpleErrors = [
    { Class: OptimisticLockError, name: 'OptimisticLockError' },
    { Class: NotFoundError, name: 'NotFoundError' },
    { Class: InvalidOperationError, name: 'InvalidOperationError' },
    { Class: RemoteConnectionError, name: 'RemoteConnectionError' },
    { Class: AccessDeniedError, name: 'AccessDeniedError' },
    { Class: UnauthorizedError, name: 'UnauthorizedError' },
    { Class: ForbiddenError, name: 'ForbiddenError' },
    { Class: NotConfiguredError, name: 'NotConfiguredError' },
    { Class: ArchivedProjectError, name: 'ArchivedProjectError' },
    { Class: ContentModerationError, name: 'ContentModerationError' },
    { Class: TooManyRequestsError, name: 'TooManyRequestsError' },
    { Class: UserBannedError, name: 'UserBannedError' },
    { Class: ConflictError, name: 'ConflictError' },
  ];

  for (const { Class, name } of simpleErrors) {
    describe(name, () => {
      it('extends Error', () => {
        const err = new Class('test message');
        expect(err).toBeInstanceOf(Error);
      });

      it('has correct name', () => {
        const err = new Class('test message');
        expect(err.name).toBe(name);
      });

      it('stores the message', () => {
        const err = new Class('custom error message');
        expect(err.message).toBe('custom error message');
      });
    });
  }

  describe('ConversationTerminatedError', () => {
    it('sets terminalEvent property', () => {
      const err = new ConversationTerminatedError('conversation_end');
      expect(err.terminalEvent).toBe('conversation_end');
    });

    it('includes terminalEvent in message', () => {
      const err = new ConversationTerminatedError('conversation_aborted');
      expect(err.message).toBe('Conversation terminated with event: conversation_aborted');
    });

    it('has correct name', () => {
      const err = new ConversationTerminatedError('conversation_failed');
      expect(err.name).toBe('ConversationTerminatedError');
    });
  });

  describe('ValidationError', () => {
    it('stores details array', () => {
      const details = [
        { code: 'too_small', path: ['name'], message: 'Name is required' },
        { code: 'invalid_type', path: ['age'], message: 'Expected number' },
      ];
      const err = new ValidationError('Validation failed', details);
      expect(err.details).toEqual(details);
    });

    it('has correct name', () => {
      const err = new ValidationError('Validation failed', []);
      expect(err.name).toBe('ValidationError');
    });

    it('extends Error', () => {
      const err = new ValidationError('Validation failed', []);
      expect(err).toBeInstanceOf(Error);
    });

    it('supports optional origin field in details', () => {
      const details = [
        { code: 'custom', path: ['field'], message: 'Invalid', origin: 'service' },
      ];
      const err = new ValidationError('Validation failed', details);
      expect(err.details[0].origin).toBe('service');
    });

    it('supports numeric minimum and inclusive fields', () => {
      const details = [
        { code: 'too_small', path: ['value'], message: 'Too small', minimum: 5, inclusive: true },
      ];
      const err = new ValidationError('Validation failed', details);
      expect(err.details[0].minimum).toBe(5);
      expect(err.details[0].inclusive).toBe(true);
    });
  });
});
