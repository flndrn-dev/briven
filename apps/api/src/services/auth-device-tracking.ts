/**
 * Device tracking — Gap Fix #6 / Sprint S2.
 *
 * Detects new devices on sign-in by hashing the user-agent string.
 * No raw IPs are stored (privacy — CLAUDE.md §5.1).
 * When a previously-unseen device signs in, a "new device" email is sent.
 */

import { createHash } from 'node:crypto';

import { runInProjectDatabase } from '../db/data-plane.js';
import { sendBrivenAuthNewDeviceLogin } from './auth-mailer.js';

/** sha-256 of the user-agent (capped). Stable key for "seen before?" checks. */
export function deviceFingerprint(userAgent: string | null | undefined): string {
  const ua = (userAgent ?? 'unknown').trim().slice(0, 256) || 'unknown';
  return createHash('sha256').update(ua).digest('hex');
}

/** Human-readable browser + OS hint for the new-device email (no raw UA). */
export function deviceHint(userAgent: string | null | undefined): string {
  const ua = userAgent ?? 'unknown device';
  const browser = /Firefox\//i.test(ua)
    ? 'Firefox'
    : /Edg\//i.test(ua)
      ? 'Edge'
      : /Chrome\//i.test(ua) && /Safari\//i.test(ua)
        ? 'Chrome'
        : /Safari\//i.test(ua)
          ? 'Safari'
          : 'browser';
  // iPhone/iPad before Mac OS — mobile Safari UAs often contain both.
  const os = /iPhone|iPad/i.test(ua)
    ? 'iOS'
    : /Android/i.test(ua)
      ? 'Android'
      : /Mac OS/i.test(ua)
        ? 'macOS'
        : /Windows/i.test(ua)
          ? 'Windows'
          : /Linux/i.test(ua)
            ? 'Linux'
            : 'unknown OS';
  return `${browser} on ${os}`;
}

export interface AuthDeviceRow {
  id: string;
  fingerprint: string;
  userAgent: string | null;
  /** Human hint only — never store as-is for display without recompute. */
  hint: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Check whether this user-agent has been seen before for the given user.
 * If not, record it and send a new-device email (fire-and-forget).
 * Known devices get `updated_at` bumped (last seen).
 */
export async function maybeAlertNewDevice(
  projectId: string,
  userId: string,
  email: string,
  userAgent: string | null | undefined,
): Promise<{ isNew: boolean }> {
  const fp = deviceFingerprint(userAgent);
  const hint = deviceHint(userAgent);

  const isNew = await runInProjectDatabase<boolean>(projectId, async (tx) => {
    const existing = (await tx.unsafe(
      `SELECT id FROM "_briven_auth_devices" WHERE user_id = $1 AND fingerprint = $2 LIMIT 1`,
      [userId, fp] as never,
    )) as Array<{ id: string }>;
    if (existing.length > 0) {
      await tx.unsafe(
        `UPDATE "_briven_auth_devices" SET updated_at = now() WHERE id = $1`,
        [existing[0]!.id] as never,
      );
      return false;
    }

    await tx.unsafe(
      `INSERT INTO "_briven_auth_devices" (id, user_id, fingerprint, user_agent, created_at, updated_at)
       VALUES (gen_random_uuid()::text, $1, $2, $3, now(), now())`,
      [userId, fp, userAgent ?? null] as never,
    );
    return true;
  });

  if (isNew) {
    void sendBrivenAuthNewDeviceLogin(projectId, email, {
      deviceHint: hint,
      whenIso: new Date().toISOString(),
      manageUrl: `${process.env.BRIVEN_API_ORIGIN ?? 'https://api.briven.tech'}/v1/auth-tenant/get-session?briven_project_id=${projectId}`,
      userAgent,
    }).catch(() => {
      // Swallow — email failure must not break sign-in.
    });
  }

  return { isNew };
}

/** List devices for a user (newest first). For admin user drawer / self profile. */
export async function listDevicesForUser(
  projectId: string,
  userId: string,
): Promise<AuthDeviceRow[]> {
  const rows = await runInProjectDatabase<
    Array<{
      id: string;
      fingerprint: string;
      user_agent: string | null;
      created_at: Date | string;
      updated_at: Date | string;
    }>
  >(projectId, async (tx) =>
    tx.unsafe(
      `SELECT id, fingerprint, user_agent, created_at, updated_at
       FROM "_briven_auth_devices"
       WHERE user_id = $1
       ORDER BY updated_at DESC
       LIMIT 50`,
      [userId] as never,
    ) as never,
  );

  return rows.map((r) => ({
    id: r.id,
    fingerprint: r.fingerprint,
    userAgent: r.user_agent,
    hint: deviceHint(r.user_agent),
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
  }));
}

export interface AuthSessionRow {
  id: string;
  createdAt: string;
  expiresAt: string | null;
  userAgent: string | null;
  hint: string;
}

/** List live sessions for a user (admin). Tokens never returned. */
export async function listSessionsForUser(
  projectId: string,
  userId: string,
): Promise<AuthSessionRow[]> {
  const rows = await runInProjectDatabase<
    Array<{
      id: string;
      created_at: Date | string;
      expires_at: Date | string | null;
      user_agent: string | null;
    }>
  >(projectId, async (tx) =>
    tx.unsafe(
      `SELECT id, created_at, expires_at, user_agent
       FROM "_briven_auth_sessions"
       WHERE user_id = $1
         AND (expires_at IS NULL OR expires_at > now())
       ORDER BY created_at DESC
       LIMIT 50`,
      [userId] as never,
    ) as never,
  );

  return rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    expiresAt:
      r.expires_at == null
        ? null
        : r.expires_at instanceof Date
          ? r.expires_at.toISOString()
          : String(r.expires_at),
    userAgent: r.user_agent,
    hint: deviceHint(r.user_agent),
  }));
}
