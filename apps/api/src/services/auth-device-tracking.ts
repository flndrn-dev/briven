/**
 * Device tracking — Gap Fix #6.
 *
 * Detects new devices on sign-in by hashing the user-agent string.
 * No raw IPs are stored (privacy — CLAUDE.md §5.1).
 * When a previously-unseen device signs in, a "new device" email is sent.
 */

import { createHash } from 'crypto';
import { runInProjectDatabase } from '../db/data-plane.js';
import { sendBrivenAuthNewDeviceLogin } from './auth-mailer.js';

function fingerprint(userAgent: string | null | undefined): string {
  const ua = (userAgent ?? 'unknown').trim().slice(0, 256);
  return createHash('sha256').update(ua).digest('hex');
}

function deviceHint(userAgent: string | null | undefined): string {
  const ua = userAgent ?? 'unknown device';
  // Extract browser name loosely.
  const browser =
    /Firefox\//i.test(ua)
      ? 'Firefox'
      : /Edg\//i.test(ua)
        ? 'Edge'
        : /Chrome\//i.test(ua) && /Safari\//i.test(ua)
          ? 'Chrome'
          : /Safari\//i.test(ua)
            ? 'Safari'
            : 'browser';
  // Extract OS loosely.
  const os = /Mac OS/i.test(ua)
    ? 'macOS'
    : /Windows/i.test(ua)
      ? 'Windows'
      : /Linux/i.test(ua)
        ? 'Linux'
        : /Android/i.test(ua)
          ? 'Android'
          : /iPhone|iPad/i.test(ua)
            ? 'iOS'
            : 'unknown OS';
  return `${browser} on ${os}`;
}

/**
 * Check whether this user-agent has been seen before for the given user.
 * If not, record it and send a new-device email (fire-and-forget).
 */
export async function maybeAlertNewDevice(
  projectId: string,
  userId: string,
  email: string,
  userAgent: string | null | undefined,
): Promise<void> {
  const fp = fingerprint(userAgent);
  const hint = deviceHint(userAgent);

  const isNew = await runInProjectDatabase<boolean>(projectId, async (tx) => {
    const existing = (await tx.unsafe(
      `SELECT id FROM "_briven_auth_devices" WHERE user_id = $1 AND fingerprint = $2 LIMIT 1`,
      [userId, fp] as never,
    )) as Array<{ id: string }>;
    if (existing.length > 0) return false;

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
      manageUrl: `https://${projectId}.auth.briven.tech/profile`,
    }).catch(() => {
      // Swallow — email failure must not break sign-in.
    });
  }
}
