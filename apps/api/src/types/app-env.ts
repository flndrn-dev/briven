import type { MemberRole } from '../db/schema.js';
import type { Session, User } from '../middleware/session.js';

/**
 * Hono `Variables` shape for routers gated by `requireAuth()` only — i.e.
 * session-or-bearer auth without per-project key support. This is the base
 * shape every authenticated route exposes.
 */
export type AppEnv = {
  Variables: {
    user: User | null;
    session: Session | null;
    requestId: string;
  };
};

/**
 * Hono `Variables` for routers gated by `requireProjectAuth()`, which sets
 * `apiKeyId` when the request is authenticated via a project-scoped API
 * key (`brk_…`) instead of a session, and `projectRole` — the caller's
 * effective `MemberRole` on the project — for both auth branches.
 */
export type ProjectAppEnv = {
  Variables: AppEnv['Variables'] & {
    apiKeyId: string | null;
    projectRole: MemberRole | null;
  };
};
