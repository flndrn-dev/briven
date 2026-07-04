import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'bun:test';

/**
 * Zone-1 data-integrity regression guards.
 *
 * The two fixes below live inside raw `sql` templates that only execute
 * against a live Postgres control plane (the full behaviour is covered by
 * account-deletion.integration.test.ts, which gates on a real DB). These
 * lightweight source guards lock in the exact predicates so a future edit
 * can't silently reintroduce the original bugs without a DB to hand.
 */

function readSrc(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
}

describe('hardDeleteExpiredAccounts GC predicate', () => {
  const src = readSrc('./account-deletion.ts');

  test('selects orgs to purge via org_members owner role (mirrors isSoleOwner)', () => {
    // The org purge must qualify orgs by OWNERSHIP, not organizations.created_by
    // alone — created_by is nulled by the 0042/0044 FK SET NULL sweep, so a
    // created_by-only predicate leaves zombie soft-deleted orgs that block the
    // user DELETE forever (the original account-deletion incident).
    expect(src).toContain('FROM org_members m');
    expect(src).toContain("m.role = 'owner'");
    expect(src).toContain('m.user_id IN (');
  });
});

describe('admin abuse-report rollup', () => {
  const src = readSrc('./admin.ts');

  test("counts open + triaged reports, never the non-existent 'investigating' status", () => {
    // abuseStatus enum is ['open','triaged','resolved'] — 'investigating' is not
    // a member, so the old predicate silently under-counted the operator queue.
    expect(src).toContain("status IN ('open', 'triaged')");
    expect(src).not.toContain('investigating');
  });
});
