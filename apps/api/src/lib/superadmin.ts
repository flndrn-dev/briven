import { env } from '../env.js';

/**
 * Env-pinned superadmin allowlist (BRIVEN_SUPERADMIN_EMAILS, comma-separated).
 *
 * Operator requirement: ONLY the email(s) set in the environment may ever be
 * treated as platform admin — the users.isAdmin DB flag alone is not enough,
 * so a "grant admin" click (or a compromised admin session flipping the flag
 * on another account) can never widen who sees or reaches the cockpit.
 *
 * When the env var is unset the check is permissive (DB flag decides) so
 * local dev keeps working; production sets it in Dokploy.
 */
const allowlist: ReadonlySet<string> | null = env.BRIVEN_SUPERADMIN_EMAILS
  ? new Set(
      env.BRIVEN_SUPERADMIN_EMAILS.split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    )
  : null;

export function isSuperadminEmail(email: string | null | undefined): boolean {
  if (!allowlist) return true;
  return !!email && allowlist.has(email.toLowerCase());
}
