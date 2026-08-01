import { logger } from '../../../utils/logger';
import type { EmailRoutingEntry, EmailRoutingResult } from './EmailRoutingTypes';
import { normalizeRoutingEntry } from './EmailRoutingTypes';

export function extractRecipientEmails(to: string | string[] | undefined): string[] {
  if (!to) return [];

  const addresses = Array.isArray(to) ? to : [to];

  const results: string[] = [];

  for (const addr of addresses) {
    const normalized = addr.trim().toLowerCase();
    if (normalized) {
      results.push(normalized);
    }
  }

  return results;
}

export function resolveEmailRouting(
  emailToProject: Record<string, string | EmailRoutingEntry> | undefined,
  recipientEmails: string[],
  fallbackProjectId: string,
  fallbackTargetEmail: string,
): EmailRoutingResult {
  if (!emailToProject || Object.keys(emailToProject).length === 0) {
    return {
      projectId: fallbackProjectId,
      targetEmail: recipientEmails[0] ?? fallbackTargetEmail,
      cc: undefined,
      bcc: undefined,
      fromAddress: undefined,
      subject: undefined,
      stageId: undefined,
      agentId: undefined,
    };
  }

  const normalizedMap: Record<string, EmailRoutingEntry> = {};

  for (const [email, entry] of Object.entries(emailToProject)) {
    normalizedMap[email.trim().toLowerCase()] = normalizeRoutingEntry(entry);
  }

  for (const recipientEmail of recipientEmails) {
    const normalized = recipientEmail.trim().toLowerCase();

    const entry = normalizedMap[normalized];
    if (entry) {
      logger.info({ recipientEmail, projectId: entry.projectId }, 'Email routed via emailToProject mapping');
      return {
        projectId: entry.projectId,
        targetEmail: normalized,
        cc: entry.cc,
        bcc: entry.bcc,
        fromAddress: entry.fromAddress,
        subject: entry.subject,
        stageId: entry.stageId,
        agentId: entry.agentId,
      };
    }
  }

  logger.warn({ recipientEmails }, 'No matching emailToProject entry, falling back to default projectId');
  return {
    projectId: fallbackProjectId,
    targetEmail: recipientEmails[0] ?? fallbackTargetEmail,
    cc: undefined,
    bcc: undefined,
    fromAddress: undefined,
    subject: undefined,
    stageId: undefined,
    agentId: undefined,
  };
}
