import { describe, it, expect } from 'vitest';
import { hasPermission, hasAllPermissions, hasAnyPermission, getPermissionsForRoles, PERMISSIONS, ROLES } from '../src/permissions';

describe('permissions', () => {
  describe('getPermissionsForRoles', () => {
    it('returns all permissions for super_admin', () => {
      const perms = getPermissionsForRoles(['super_admin']);
      expect(perms).toHaveLength(Object.values(PERMISSIONS).length);
      expect(perms).toContain(PERMISSIONS.PROJECT_READ);
      expect(perms).toContain(PERMISSIONS.SYSTEM_CONFIG);
    });

    it('returns no permissions for unknown role', () => {
      const perms = getPermissionsForRoles(['unknown_role']);
      expect(perms).toHaveLength(0);
    });

    it('returns no permissions for empty roles array', () => {
      const perms = getPermissionsForRoles([]);
      expect(perms).toHaveLength(0);
    });

    it('merges permissions from multiple roles without duplicates', () => {
      const perms = getPermissionsForRoles(['support', 'developer']);
      expect(perms).toContain(PERMISSIONS.USER_READ);
      expect(perms).toContain(PERMISSIONS.ISSUE_WRITE);
      expect(perms).toContain(PERMISSIONS.SYSTEM_CONFIG);
      const uniquePerms = new Set(perms);
      expect(uniquePerms.size).toBe(perms.length);
    });

    it('returns correct permissions for viewer role', () => {
      const perms = getPermissionsForRoles(['viewer']);
      expect(perms).toContain(PERMISSIONS.PROJECT_READ);
      expect(perms).not.toContain(PERMISSIONS.PROJECT_WRITE);
      expect(perms).not.toContain(PERMISSIONS.SYSTEM_CONFIG);
    });

    it('returns correct permissions for support role', () => {
      const perms = getPermissionsForRoles(['support']);
      expect(perms).toContain(PERMISSIONS.ISSUE_READ);
      expect(perms).toContain(PERMISSIONS.ISSUE_WRITE);
      expect(perms).not.toContain(PERMISSIONS.AGENT_READ);
    });

    it('ignores unknown roles mixed with valid roles', () => {
      const perms = getPermissionsForRoles(['unknown_role', 'viewer']);
      expect(perms.length).toBeGreaterThan(0);
      expect(perms).toEqual(getPermissionsForRoles(['viewer']));
    });
  });

  describe('hasPermission', () => {
    it('returns true when role has the permission', () => {
      expect(hasPermission(['super_admin'], PERMISSIONS.PROJECT_READ)).toBe(true);
    });

    it('returns false when role lacks the permission', () => {
      expect(hasPermission(['viewer'], PERMISSIONS.PROJECT_WRITE)).toBe(false);
    });

    it('returns false for empty roles', () => {
      expect(hasPermission([], PERMISSIONS.PROJECT_READ)).toBe(false);
    });

    it('checks across multiple roles', () => {
      expect(hasPermission(['developer', 'viewer'], PERMISSIONS.SYSTEM_CONFIG)).toBe(true);
    });
  });

  describe('hasAllPermissions', () => {
    it('returns true when all permissions are present', () => {
      expect(hasAllPermissions(['super_admin'], [PERMISSIONS.PROJECT_READ, PERMISSIONS.PROJECT_WRITE])).toBe(true);
    });

    it('returns false when any permission is missing', () => {
      expect(hasAllPermissions(['viewer'], [PERMISSIONS.PROJECT_READ, PERMISSIONS.PROJECT_WRITE])).toBe(false);
    });

    it('returns true for empty required permissions', () => {
      expect(hasAllPermissions(['viewer'], [])).toBe(true);
    });

    it('returns false for empty roles with required permissions', () => {
      expect(hasAllPermissions([], [PERMISSIONS.PROJECT_READ])).toBe(false);
    });
  });

  describe('hasAnyPermission', () => {
    it('returns true when at least one permission is present', () => {
      expect(hasAnyPermission(['viewer'], [PERMISSIONS.PROJECT_WRITE, PERMISSIONS.PROJECT_READ])).toBe(true);
    });

    it('returns false when no permissions match', () => {
      expect(hasAnyPermission(['viewer'], [PERMISSIONS.PROJECT_WRITE, PERMISSIONS.SYSTEM_CONFIG])).toBe(false);
    });

    it('returns false for empty required permissions', () => {
      expect(hasAnyPermission(['viewer'], [])).toBe(false);
    });
  });

  describe('ROLES definitions', () => {
    it('defines all expected roles', () => {
      expect(ROLES).toHaveProperty('super_admin');
      expect(ROLES).toHaveProperty('content_manager');
      expect(ROLES).toHaveProperty('support');
      expect(ROLES).toHaveProperty('developer');
      expect(ROLES).toHaveProperty('viewer');
    });

    it('each role has name, description, and permissions', () => {
      for (const [, role] of Object.entries(ROLES)) {
        const r = role as { name: string; description: string; permissions: string[] };
        expect(r.name).toBeDefined();
        expect(r.description).toBeDefined();
        expect(Array.isArray(r.permissions)).toBe(true);
      }
    });

    it('super_admin has all defined permissions', () => {
      const superAdminPerms = ROLES.super_admin.permissions;
      for (const perm of Object.values(PERMISSIONS)) {
        expect(superAdminPerms).toContain(perm);
      }
    });

    it('viewer has only read permissions', () => {
      const viewerPerms = ROLES.viewer.permissions;
      for (const perm of viewerPerms) {
        expect(perm.endsWith(':read')).toBe(true);
      }
    });
  });
});
