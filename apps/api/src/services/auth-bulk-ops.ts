/**
 * Bulk operations for briven auth tenants (Phase 6.4).
 *
 * Dashboard-driven bulk actions on users: ban, delete, invite.
 * Each operation returns per-item results so the UI can show partial
 * successes (e.g. 47 of 50 banned, 3 not found).
 */

import { runInProjectDatabase } from '../db/data-plane.js';
import { banUser } from './auth-security.js';
import { createOrgInvite } from './auth-orgs.js';

export interface BulkResult {
  processed: number;
  succeeded: number;
  failed: number;
  errors: Array<{ index: number; userId?: string; email?: string; message: string }>;
}

const BATCH_SIZE = 100;

export async function bulkBanUsers(
  projectId: string,
  userIds: string[],
  reason?: string,
): Promise<BulkResult> {
  const result: BulkResult = { processed: 0, succeeded: 0, failed: 0, errors: [] };
  const ids = userIds.slice(0, BATCH_SIZE);

  for (let i = 0; i < ids.length; i++) {
    const userId = ids[i]!;
    result.processed++;
    try {
      await banUser(projectId, userId, { reason });
      result.succeeded++;
    } catch (err) {
      result.failed++;
      result.errors.push({
        index: i,
        userId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

export async function bulkDeleteUsers(
  projectId: string,
  userIds: string[],
): Promise<BulkResult> {
  const result: BulkResult = { processed: 0, succeeded: 0, failed: 0, errors: [] };
  const ids = userIds.slice(0, BATCH_SIZE);

  await runInProjectDatabase(projectId, async (tx) => {
    for (let i = 0; i < ids.length; i++) {
      const userId = ids[i]!;
      result.processed++;
      try {
        // Cascading delete via FKs handles sessions, accounts, org membership, etc.
        await tx.unsafe(
          `DELETE FROM "_briven_auth_users" WHERE id = $1`,
          [userId] as never[],
        );
        result.succeeded++;
      } catch (err) {
        result.failed++;
        result.errors.push({
          index: i,
          userId,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  });

  return result;
}

export interface BulkInviteInput {
  orgId: string;
  emails: string[];
  role?: 'admin' | 'member';
  invitedBy: string;
}

export async function bulkInviteUsers(
  projectId: string,
  input: BulkInviteInput,
): Promise<BulkResult> {
  const result: BulkResult = { processed: 0, succeeded: 0, failed: 0, errors: [] };
  const emails = input.emails.slice(0, BATCH_SIZE);

  for (let i = 0; i < emails.length; i++) {
    const email = emails[i]!;
    result.processed++;
    try {
      await createOrgInvite(
        projectId,
        input.orgId,
        input.invitedBy,
        { email, role: input.role ?? 'member' },
      );
      result.succeeded++;
    } catch (err) {
      result.failed++;
      result.errors.push({
        index: i,
        email,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}
