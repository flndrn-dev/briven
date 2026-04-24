import { desc, eq } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import { sessions, users } from '../db/schema.js';
import { lookupIp } from '../lib/geoip.js';

export interface ProfilePatch {
  name?: string | null;
  legalName?: string | null;
  companyName?: string | null;
  vatId?: string | null;
  vatVerifiedAt?: Date | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  addressCity?: string | null;
  addressPostalCode?: string | null;
  addressRegion?: string | null;
  addressCountry?: string | null;
}

export async function getCurrentVat(userId: string): Promise<{ vatId: string | null; vatVerifiedAt: Date | null }> {
  const db = getDb();
  const [row] = await db
    .select({ vatId: users.vatId, vatVerifiedAt: users.vatVerifiedAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row ?? { vatId: null, vatVerifiedAt: null };
}

/**
 * Fetch the KYC / profile block for the signed-in user.
 * Returns what's persisted in `users` plus the most recent session's IP
 * (sanitised to the anonymised form — full IP is visible only to the
 * account holder per GDPR access rights, and only in their own response).
 */
export async function getProfile(userId: string) {
  const db = getDb();
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      emailVerified: users.emailVerified,
      name: users.name,
      image: users.image,
      isAdmin: users.isAdmin,
      suspendedAt: users.suspendedAt,
      legalName: users.legalName,
      companyName: users.companyName,
      vatId: users.vatId,
      vatVerifiedAt: users.vatVerifiedAt,
      addressLine1: users.addressLine1,
      addressLine2: users.addressLine2,
      addressCity: users.addressCity,
      addressPostalCode: users.addressPostalCode,
      addressRegion: users.addressRegion,
      addressCountry: users.addressCountry,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) throw new Error('user vanished mid-request');

  const [last] = await db
    .select({
      createdAt: sessions.createdAt,
      ipAddress: sessions.ipAddress,
      userAgent: sessions.userAgent,
    })
    .from(sessions)
    .where(eq(sessions.userId, userId))
    .orderBy(desc(sessions.createdAt))
    .limit(1);

  const nearBy = last ? await lookupIp(last.ipAddress) : null;

  return {
    ...row,
    lastSignIn: last
      ? {
          at: last.createdAt,
          ipAddress: last.ipAddress,
          userAgent: last.userAgent,
          nearBy,
        }
      : null,
  };
}

export async function updateProfile(userId: string, patch: ProfilePatch): Promise<void> {
  const db = getDb();
  await db
    .update(users)
    .set({
      ...patch,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
}

export async function setAvatar(userId: string, dataUri: string | null): Promise<void> {
  const db = getDb();
  await db
    .update(users)
    .set({ image: dataUri, updatedAt: new Date() })
    .where(eq(users.id, userId));
}
