import { v7 as uuidv7 } from 'uuid';

/**
 * Entity type prefixes for ID generation
 */
export const ID_PREFIXES = {
  OPERATOR: 'oper',
  USER: 'user',
  PROJECT: 'proj',
  AGENT: 'agnt',
  CLASSIFIER: 'clas',
  CONTEXT_TRANSFORMER: 'tran',
  TOOL: 'tool',
  STAGE: 'stag',
  KNOWLEDGE_SECTION: 'ksec',
  KNOWLEDGE_CATEGORY: 'kcat',
  KNOWLEDGE_ITEM: 'kitm',
  GLOBAL_ACTION: 'gact',
  GUARDRAIL: 'gurl',
  PROVIDER: 'prov',
  ENVIRONMENT: 'env',
  API_KEY: 'akey',
  CONVERSATION: 'conv',
  AUDIT: 'audt',
  EVENT: 'evnt',
  REQUEST: 'req',
  INPUT: 'tinp',
  OUTPUT: 'tout',
  CHUNK: 'chnk',
  ARTIFACT: 'artf'
} as const;

type EntityPrefix = (typeof ID_PREFIXES)[keyof typeof ID_PREFIXES];

/**
 * Generates a unique, time-sortable ID using UUIDv7.
 *
 * UUIDv7 embeds a millisecond-precision Unix timestamp in the most-significant
 * bits and fills the remainder with cryptographically secure random bytes
 * (`crypto.getRandomValues`), providing both natural sort order and
 * collision resistance.
 *
 * Format: {prefix}_{uuidv7}
 * Example: proj_019cc9b7-bf52-7577-a915-25c17a83c4e6
 *
 * @param prefix - Entity type prefix (e.g., 'proj', 'conv', 'audit')
 * @returns Generated unique ID string
 */
export function generateId(prefix: EntityPrefix | string): string {
  return `${prefix}_${uuidv7()}`;
}
