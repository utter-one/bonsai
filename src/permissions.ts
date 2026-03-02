/**
 * Permission configuration for RBAC system
 * Defines roles and their associated permissions in entity:action format
 */

/** All available permissions in the system */
export const PERMISSIONS = {
  // Operator permissions
  OPERATOR_READ: 'operator:read',
  OPERATOR_WRITE: 'operator:write',
  OPERATOR_DELETE: 'operator:delete',

  // User permissions
  USER_READ: 'user:read',
  USER_WRITE: 'user:write',
  USER_DELETE: 'user:delete',

  // Project permissions
  PROJECT_READ: 'project:read',
  PROJECT_WRITE: 'project:write',
  PROJECT_DELETE: 'project:delete',

  // Agent permissions
  AGENT_READ: 'agent:read',
  AGENT_WRITE: 'agent:write',
  AGENT_DELETE: 'agent:delete',

  // Conversation permissions
  CONVERSATION_READ: 'conversation:read',
  CONVERSATION_WRITE: 'conversation:write',
  CONVERSATION_DELETE: 'conversation:delete',

  // Stage permissions
  STAGE_READ: 'stage:read',
  STAGE_WRITE: 'stage:write',
  STAGE_DELETE: 'stage:delete',

  // Classifier permissions
  CLASSIFIER_READ: 'classifier:read',
  CLASSIFIER_WRITE: 'classifier:write',
  CLASSIFIER_DELETE: 'classifier:delete',

  // Context Transformer permissions
  CONTEXT_TRANSFORMER_READ: 'context_transformer:read',
  CONTEXT_TRANSFORMER_WRITE: 'context_transformer:write',
  CONTEXT_TRANSFORMER_DELETE: 'context_transformer:delete',

  // Tool permissions
  TOOL_READ: 'tool:read',
  TOOL_WRITE: 'tool:write',
  TOOL_DELETE: 'tool:delete',

  // Global Action permissions
  GLOBAL_ACTION_READ: 'global_action:read',
  GLOBAL_ACTION_WRITE: 'global_action:write',
  GLOBAL_ACTION_DELETE: 'global_action:delete',

  // Environment permissions
  ENVIRONMENT_READ: 'environment:read',
  ENVIRONMENT_WRITE: 'environment:write',
  ENVIRONMENT_DELETE: 'environment:delete',

  // Knowledge permissions
  KNOWLEDGE_READ: 'knowledge:read',
  KNOWLEDGE_WRITE: 'knowledge:write',
  KNOWLEDGE_DELETE: 'knowledge:delete',

  // Issue permissions
  ISSUE_READ: 'issue:read',
  ISSUE_WRITE: 'issue:write',
  ISSUE_DELETE: 'issue:delete',

  // Provider permissions
  PROVIDER_READ: 'provider:read',
  PROVIDER_WRITE: 'provider:write',
  PROVIDER_DELETE: 'provider:delete',

  // API Key permissions
  API_KEY_READ: 'api_key:read',
  API_KEY_WRITE: 'api_key:write',
  API_KEY_DELETE: 'api_key:delete',

  // Migration permissions
  MIGRATION_EXPORT: 'migration:export',
  MIGRATION_IMPORT: 'migration:import',

  // System permissions
  SYSTEM_CONFIG: 'system:config',
  AUDIT_READ: 'audit:read',
} as const;

/** Type for permission values */
export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/** Role definitions with their associated permissions */
export const ROLES = {
  super_admin: {
    name: 'Super Admin',
    description: 'Full system access with all permissions',
    permissions: Object.values(PERMISSIONS),
  },
  content_manager: {
    name: 'Content Manager',
    description: 'Manage content entities (agents, conversations, users, knowledge)',
    permissions: [
      PERMISSIONS.USER_READ,
      PERMISSIONS.USER_WRITE,
      PERMISSIONS.PROJECT_READ,
      PERMISSIONS.PROJECT_WRITE,
      PERMISSIONS.AGENT_READ,
      PERMISSIONS.AGENT_WRITE,
      PERMISSIONS.CONVERSATION_READ,
      PERMISSIONS.CONVERSATION_WRITE,
      PERMISSIONS.STAGE_READ,
      PERMISSIONS.STAGE_WRITE,
      PERMISSIONS.CLASSIFIER_READ,
      PERMISSIONS.CLASSIFIER_WRITE,
      PERMISSIONS.CONTEXT_TRANSFORMER_READ,
      PERMISSIONS.CONTEXT_TRANSFORMER_WRITE,
      PERMISSIONS.TOOL_READ,
      PERMISSIONS.TOOL_WRITE,
      PERMISSIONS.GLOBAL_ACTION_READ,
      PERMISSIONS.GLOBAL_ACTION_WRITE,
      PERMISSIONS.KNOWLEDGE_READ,
      PERMISSIONS.KNOWLEDGE_WRITE,
      PERMISSIONS.PROVIDER_READ,
      PERMISSIONS.PROVIDER_WRITE,
      PERMISSIONS.API_KEY_READ,
      PERMISSIONS.API_KEY_WRITE,
      PERMISSIONS.API_KEY_DELETE,
      PERMISSIONS.AUDIT_READ,
    ],
  },
  support: {
    name: 'Support',
    description: 'View and assist with user-related issues',
    permissions: [
      PERMISSIONS.USER_READ,
      PERMISSIONS.USER_WRITE,
      PERMISSIONS.PROJECT_READ,
      PERMISSIONS.CONVERSATION_READ,
      PERMISSIONS.ISSUE_READ,
      PERMISSIONS.ISSUE_WRITE,
      PERMISSIONS.AUDIT_READ,
    ],
  },
  developer: {
    name: 'Developer',
    description: 'Technical access for development and debugging',
    permissions: [
      PERMISSIONS.USER_READ,
      PERMISSIONS.PROJECT_READ,
      PERMISSIONS.AGENT_READ,
      PERMISSIONS.CONVERSATION_READ,
      PERMISSIONS.STAGE_READ,
      PERMISSIONS.CLASSIFIER_READ,
      PERMISSIONS.CONTEXT_TRANSFORMER_READ,
      PERMISSIONS.TOOL_READ,
      PERMISSIONS.GLOBAL_ACTION_READ,
      PERMISSIONS.KNOWLEDGE_READ,
      PERMISSIONS.ISSUE_READ,
      PERMISSIONS.PROVIDER_READ,
      PERMISSIONS.API_KEY_READ,
      PERMISSIONS.SYSTEM_CONFIG,
      PERMISSIONS.AUDIT_READ,
    ],
  },
  viewer: {
    name: 'Viewer',
    description: 'Read-only access to most entities',
    permissions: [
      PERMISSIONS.USER_READ,
      PERMISSIONS.PROJECT_READ,
      PERMISSIONS.AGENT_READ,
      PERMISSIONS.CONVERSATION_READ,
      PERMISSIONS.STAGE_READ,
      PERMISSIONS.CLASSIFIER_READ,
      PERMISSIONS.CONTEXT_TRANSFORMER_READ,
      PERMISSIONS.TOOL_READ,
      PERMISSIONS.GLOBAL_ACTION_READ,
      PERMISSIONS.KNOWLEDGE_READ,
      PERMISSIONS.ISSUE_READ,
      PERMISSIONS.PROVIDER_READ,
      PERMISSIONS.API_KEY_READ,
      PERMISSIONS.AUDIT_READ,
    ],
  },
} as const;

/** Type for role names */
export type RoleName = keyof typeof ROLES;

/**
 * Get all permissions for a given set of roles
 * @param roles - Array of role names
 * @returns Array of unique permissions
 */
export function getPermissionsForRoles(roles: string[]): Permission[] {
  const permissions = new Set<Permission>();

  for (const role of roles) {
    if (role in ROLES) {
      const roleConfig = ROLES[role as RoleName];
      roleConfig.permissions.forEach(permission => permissions.add(permission));
    }
  }

  return Array.from(permissions);
}

/**
 * Check if a set of roles has a specific permission
 * @param roles - Array of role names
 * @param permission - Permission to check
 * @returns True if any role has the permission
 */
export function hasPermission(roles: string[], permission: Permission): boolean {
  const permissions = getPermissionsForRoles(roles);
  return permissions.includes(permission);
}

/**
 * Check if a set of roles has all of the specified permissions
 * @param roles - Array of role names
 * @param requiredPermissions - Array of permissions to check
 * @returns True if roles have all required permissions
 */
export function hasAllPermissions(roles: string[], requiredPermissions: Permission[]): boolean {
  const permissions = getPermissionsForRoles(roles);
  return requiredPermissions.every(required => permissions.includes(required));
}

/**
 * Check if a set of roles has any of the specified permissions
 * @param roles - Array of role names
 * @param requiredPermissions - Array of permissions to check
 * @returns True if roles have at least one required permission
 */
export function hasAnyPermission(roles: string[], requiredPermissions: Permission[]): boolean {
  const permissions = getPermissionsForRoles(roles);
  return requiredPermissions.some(required => permissions.includes(required));
}
