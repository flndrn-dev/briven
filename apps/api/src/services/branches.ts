import { brivenError, newId } from '@briven/shared';

/**
 * Branching / preview environments — Phase 4 future-feature SKELETON.
 *
 * This file exists today to (a) pin the data model + API shape so the
 * dashboard and CLI can wire against a stable surface, (b) give an
 * operator a path to land the full implementation incrementally, and
 * (c) document what's intentionally NOT in v1.
 *
 * The full implementation has three parts:
 *
 *   1. Meta-DB row in `project_branches` linking a branch name to its
 *      parent project + parent branch. Cascade-deletes when the parent
 *      project deletes.
 *
 *   2. Data-plane work: clone the project's postgres schema into a new
 *      schema named `proj_<projectId>_<branchSlug>`. Empty initially
 *      (structure only). Optional `--copy-data` flag for ~100MB shards.
 *
 *   3. Routing layer: `<branchSlug>.<projectSlug>.apps.briven.tech`
 *      resolves via wildcard traefik to the api, which sees the host
 *      header, looks up the branch, and routes the function call to
 *      the cloned schema instead of the parent's.
 *
 * Today the code below is the type contract — calls throw
 * `not_implemented` so the dashboard renders an "available in v2"
 * banner instead of breaking. When the data-plane clone path lands,
 * replace the stub bodies; the route handlers and CLI commands don't
 * need to change.
 */

export interface ProjectBranch {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  /** Slug derived from name + must be DNS-safe — `^[a-z0-9-]+$`, 1-32 chars. */
  readonly slug: string;
  /** Parent branch id. `null` means parent is the project's main schema. */
  readonly parentBranchId: string | null;
  /** When the branch was created. */
  readonly createdAt: Date;
  /** Soft-delete timestamp. Branches live ~30 days after delete then
   * the schema is dropped + the row is hard-deleted by a cron. */
  readonly deletedAt: Date | null;
  /** Whether `--copy-data` was passed at create time. Drives storage
   * usage attribution. */
  readonly hasDataCopy: boolean;
}

export interface CreateBranchInput {
  readonly projectId: string;
  readonly name: string;
  /** Source branch — defaults to the project's main schema. */
  readonly fromBranchId?: string;
  /** When true, the data-plane clone copies all rows. When false (default),
   * only the schema (tables/indexes/constraints) is cloned. */
  readonly copyData?: boolean;
}

export async function createBranch(_input: CreateBranchInput): Promise<ProjectBranch> {
  throw new brivenError(
    'not_implemented',
    'branching is a Phase 4 feature — see docs/BUILD_PLAN.md',
    { status: 501 },
  );
}

export async function listBranches(_projectId: string): Promise<readonly ProjectBranch[]> {
  // Returns empty until the v2 implementation lands. The dashboard
  // renders the "no branches yet" state, which is also accurate
  // because there ARE no branches yet.
  return [];
}

export async function deleteBranch(_branchId: string): Promise<void> {
  throw new brivenError(
    'not_implemented',
    'branching is a Phase 4 feature — see docs/BUILD_PLAN.md',
    { status: 501 },
  );
}

/**
 * Slug derivation matches the data-plane schema name suffix. Lowercase
 * the input, replace non-DNS chars with `-`, collapse repeats, trim
 * to 32. ULID for uniqueness guarantee (so two branches with the same
 * name on the same project don't collide).
 */
export function slugifyBranchName(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  if (!base) throw new brivenError('validation_failed', 'branch name produces empty slug', { status: 400 });
  return `${base}-${newId('br').slice(3, 11).toLowerCase()}`;
}
