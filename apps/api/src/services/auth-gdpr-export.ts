/**
 * GDPR data export — Gap Fix #15.
 *
 * Returns a structured JSON dump of every record that belongs to a
 * specific user across all briven auth tables in the project's tenant
 * database. This is used for the "right to data portability" and
 * "right of access" flows, and is called before account deletion so
 * the admin can provide the user with a copy of their data.
 *
 * PII that is normally redacted in admin views (raw IPs, full emails
 * of other users) is NOT included — only the target user's own data.
 */

import { runInProjectDatabase } from '../db/data-plane.js';

export interface UserDataExport {
  user: unknown;
  sessions: unknown[];
  accounts: unknown[];
  twoFactors: unknown[];
  passkeys: unknown[];
  security: unknown | null;
  metadata: unknown | null;
  emails: unknown[];
  usernames: unknown[];
  devices: unknown[];
  orgMemberships: unknown[];
  orgInvites: unknown[];
  membershipRequests: unknown[];
  auditLog: unknown[];
  ssoSessions: unknown[];
  impersonationSessions: unknown[];
  passwordHistory: unknown[];
  exportedAt: string;
}

export async function exportUserData(
  projectId: string,
  userId: string,
): Promise<UserDataExport> {
  return runInProjectDatabase<UserDataExport>(projectId, async (tx) => {
    const user = (
      (await tx.unsafe(
        `SELECT id, name, email, email_verified, image, two_factor_enabled, created_at, updated_at
         FROM "_briven_auth_users" WHERE id = $1 LIMIT 1`,
        [userId] as never,
      )) as unknown[]
    )[0];

    const sessions = await tx.unsafe(
      `SELECT id, token, expires_at, user_agent, created_at, updated_at
       FROM "_briven_auth_sessions" WHERE user_id = $1`,
      [userId] as never,
    );

    const accounts = await tx.unsafe(
      `SELECT id, account_id, provider_id, scope, created_at, updated_at
       FROM "_briven_auth_accounts" WHERE user_id = $1`,
      [userId] as never,
    );

    const twoFactors = await tx.unsafe(
      `SELECT id, backup_codes, verified, created_at, updated_at
       FROM "_briven_auth_two_factors" WHERE user_id = $1`,
      [userId] as never,
    );

    const passkeys = await tx.unsafe(
      `SELECT id, name, credential_id, counter, created_at, updated_at
       FROM "_briven_auth_passkeys" WHERE user_id = $1`,
      [userId] as never,
    );

    const security = (
      (await tx.unsafe(
        `SELECT suspended_at, suspended_reason, banned_at, banned_reason, ban_expires_at, created_at, updated_at
         FROM "_briven_auth_user_security" WHERE user_id = $1 LIMIT 1`,
        [userId] as never,
      )) as unknown[]
    )[0] ?? null;

    const metadata = (
      (await tx.unsafe(
        `SELECT public_metadata, private_metadata, created_at, updated_at
         FROM "_briven_auth_user_metadata" WHERE user_id = $1 LIMIT 1`,
        [userId] as never,
      )) as unknown[]
    )[0] ?? null;

    const emails = await tx.unsafe(
      `SELECT id, email, verified, primary, created_at, updated_at
       FROM "_briven_auth_user_emails" WHERE user_id = $1`,
      [userId] as never,
    );

    const usernames = await tx.unsafe(
      `SELECT id, username, created_at, updated_at
       FROM "_briven_auth_user_usernames" WHERE user_id = $1`,
      [userId] as never,
    );

    const devices = await tx.unsafe(
      `SELECT id, fingerprint, user_agent, created_at, updated_at
       FROM "_briven_auth_devices" WHERE user_id = $1`,
      [userId] as never,
    );

    const orgMemberships = await tx.unsafe(
      `SELECT id, org_id, role, created_at, updated_at
       FROM "_briven_auth_org_members" WHERE user_id = $1`,
      [userId] as never,
    );

    const orgInvites = await tx.unsafe(
      `SELECT id, org_id, email, role, token, expires_at, accepted_at, created_at, updated_at
       FROM "_briven_auth_org_invites" WHERE invited_by = $1`,
      [userId] as never,
    );

    const membershipRequests = await tx.unsafe(
      `SELECT id, org_id, status, message, requested_at, resolved_at, resolved_by, created_at, updated_at
       FROM "_briven_auth_org_membership_requests" WHERE user_id = $1`,
      [userId] as never,
    );

    const auditLog = await tx.unsafe(
      `SELECT id, action, metadata, occurred_at
       FROM "_briven_auth_audit_log" WHERE user_id = $1
       ORDER BY occurred_at DESC
       LIMIT 1000`,
      [userId] as never,
    );

    const ssoSessions = await tx.unsafe(
      `SELECT s.id, s.session_id, s.connection_id, s.created_at, s.updated_at
       FROM "_briven_auth_sso_sessions" s
       JOIN "_briven_auth_sessions" sess ON s.session_id = sess.id
       WHERE sess.user_id = $1`,
      [userId] as never,
    );

    const impersonationSessions = await tx.unsafe(
      `SELECT i.id, i.session_id, i.impersonated_by, i.target_user_id, i.stopped_at, i.created_at, i.updated_at
       FROM "_briven_auth_impersonation_sessions" i
       JOIN "_briven_auth_sessions" sess ON i.session_id = sess.id
       WHERE sess.user_id = $1 OR i.target_user_id = $1`,
      [userId] as never,
    );

    const passwordHistory = await tx.unsafe(
      `SELECT id, password_hash, created_at
       FROM "_briven_auth_password_history" WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId] as never,
    );

    return {
      user: user ?? null,
      sessions: sessions as unknown[],
      accounts: accounts as unknown[],
      twoFactors: twoFactors as unknown[],
      passkeys: passkeys as unknown[],
      security,
      metadata,
      emails: emails as unknown[],
      usernames: usernames as unknown[],
      devices: devices as unknown[],
      orgMemberships: orgMemberships as unknown[],
      orgInvites: orgInvites as unknown[],
      membershipRequests: membershipRequests as unknown[],
      auditLog: auditLog as unknown[],
      ssoSessions: ssoSessions as unknown[],
      impersonationSessions: impersonationSessions as unknown[],
      passwordHistory: passwordHistory as unknown[],
      exportedAt: new Date().toISOString(),
    };
  });
}
