/**
 * Entity type prefixes for ID generation
 */
export const ID_PREFIXES = {
  ADMIN: 'adm',
  USER: 'user',
  PROJECT: 'proj',
  PERSONA: 'pers',
  CLASSIFIER: 'clas',
  CONTEXT_TRANSFORMER: 'tran',
  TOOL: 'tool',
  STAGE: 'stag',
  KNOWLEDGE_SECTION: 'ksec',
  KNOWLEDGE_CATEGORY: 'kcat',
  KNOWLEDGE_ITEM: 'kitm',
  GLOBAL_ACTION: 'gact',
  PROVIDER: 'prov',
  ENVIRONMENT: 'env',
  API_KEY: 'akey',
  CONVERSATION: 'conv',
  AUDIT: 'audt',
  EVENT: 'evnt',
  REQUEST: 'req',
} as const;

type EntityPrefix = (typeof ID_PREFIXES)[keyof typeof ID_PREFIXES];

/**
 * Generates a unique ID with a timestamp and random component
 * Format: {prefix}_{timestamp}_{random}
 * Example: proj_1737980123456_abc123def
 * 
 * @param prefix - Entity type prefix (e.g., 'proj', 'conv', 'audit')
 * @returns Generated unique ID string
 */
export function generateId(prefix: EntityPrefix | string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 9);
  return `${prefix}_${timestamp}_${random}`;
}
