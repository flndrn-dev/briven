import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { getDb } from '../db/client.js';
import { users } from '../db/schema.js';
import { auth } from '../lib/auth.js';
import { requireAuth } from '../middleware/session.js';
import { rateLimit } from '../middleware/rate-limit.js';
import type { AppEnv } from '../types/app-env.js';
import { softDeleteAccount } from '../services/account-deletion.js';
import { audit, hashIp } from '../services/audit.js';
import { checkVatWithVies } from '../services/billing.js';
import {
  getCurrentVat,
  getProfile,
  setAvatar,
  updateProfile,
  type ProfilePatch,
} from '../services/me.js';
import { listOrgsForUser } from '../services/orgs.js';
import { listProjectsForUser } from '../services/projects.js';
import { listMyStorageUsage } from '../services/storage-admin.js';

const patchSchema = z.object({
  name: z.string().min(1).max(200).nullable().optional(),
  legalName: z.string().min(1).max(200).nullable().optional(),
  companyName: z.string().max(200).nullable().optional(),
  companyRegistrationNumber: z.string().max(64).nullable().optional(),
  vatId: z.string().max(32).nullable().optional(),
  addressLine1: z.string().max(200).nullable().optional(),
  addressLine2: z.string().max(200).nullable().optional(),
  addressCity: z.string().max(120).nullable().optional(),
  addressPostalCode: z.string().max(32).nullable().optional(),
  addressRegion: z.string().max(120).nullable().optional(),
  addressCountry: z
    .string()
    .regex(/^[A-Z]{2}$/u, 'country must be an ISO 3166-1 alpha-2 code')
    .nullable()
    .optional(),
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/u, 'date of birth must be ISO yyyy-mm-dd')
    .nullable()
    .optional(),
  countryOfBirth: z
    .string()
    .regex(/^[A-Z]{2}$/u, 'country of birth must be an ISO 3166-1 alpha-2 code')
    .nullable()
    .optional(),
  timezone: z
    .string()
    .min(1)
    .max(64)
    .regex(
      /^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)+$/u,
      'timezone must be an IANA zone (e.g. Europe/Brussels)',
    )
    .nullable()
    .optional(),
});

export const meRouter = new Hono<AppEnv>();

meRouter.get('/v1/me', requireAuth(), async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ code: 'unauthorized', message: 'authentication required' }, 401);
  const profile = await getProfile(user.id);
  return c.json(profile);
});

// Lightweight "what projects can I see?" list used by the CLI's wizard
// (`existingBranch`) and by any caller that wants the minimum-viable
// numbered-list payload without the dashboard-only enrichments returned
// by `/v1/projects`. Six fields, one per project: id, slug, name, region,
// tier, orgName. Same membership semantics as `listProjectsForUser` —
// org-scoped OR project-scoped — joined to org for the org name.
meRouter.get('/v1/me/projects', requireAuth(), async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ code: 'unauthorized', message: 'authentication required' }, 401);
  const [rows, orgs] = await Promise.all([
    listProjectsForUser(user.id),
    listOrgsForUser(user.id),
  ]);
  const orgsById = new Map(orgs.map((o) => [o.id, o]));
  const projects = rows.map((p) => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    region: p.region,
    tier: p.tier,
    orgName: orgsById.get(p.orgId)?.name ?? null,
  }));
  return c.json({ projects });
});

// Cross-project object-storage ("S3 bucket") usage for the dashboard home:
// every project the caller belongs to, with its file bytes used vs tier cap
// and active storage-key count. User-scoped via listMyStorageUsage — only the
// caller's own projects are ever returned.
meRouter.get('/v1/me/storage', requireAuth(), async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ code: 'unauthorized', message: 'authentication required' }, 401);
  return c.json({ usage: await listMyStorageUsage(user.id) });
});

meRouter.patch('/v1/me', requireAuth(), async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ code: 'unauthorized', message: 'authentication required' }, 401);

  const body = await c.req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { code: 'validation_failed', message: 'invalid request body', issues: parsed.error.issues },
      400,
    );
  }

  // VAT is special. If the caller is changing vatId, we need to:
  //  1. reject the edit if their existing VAT is already verified — support
  //     has to handle that change (tax treatment is tied to a point-in-time
  //     attestation we relied on).
  //  2. otherwise, call VIES and stamp vat_verified_at ONLY on 'valid'.
  //     'invalid' or 'unverifiable' both save without the timestamp — a
  //     VIES registry outage or a user typing their own number that VIES
  //     temporarily doesn't recognise must not block the rest of the form.
  //     The live debounced check (GET /v1/billing/vat/check) already warns
  //     the user about the state; the save is intentionally permissive.
  const patch: ProfilePatch = { ...parsed.data };
  if ('vatId' in patch) {
    const current = await getCurrentVat(user.id);
    if (current.vatVerifiedAt && patch.vatId !== current.vatId) {
      return c.json(
        {
          code: 'vat_locked',
          message:
            'VAT is verified and locked — changes require a support request (phase 3 will surface a contact flow)',
        },
        403,
      );
    }
    if (patch.vatId) {
      const check = await checkVatWithVies(patch.vatId);
      patch.vatVerifiedAt = check.state === 'valid' ? new Date() : null;
    } else {
      patch.vatVerifiedAt = null;
    }
  }

  await updateProfile(user.id, patch);

  // Audit which fields changed; never log the values themselves.
  await audit({
    actorId: user.id,
    projectId: null,
    action: 'me.update',
    ipHash: hashIp(c.req.raw.headers.get('x-forwarded-for')),
    userAgent: c.req.header('user-agent') ?? null,
    metadata: { fields: Object.keys(parsed.data) },
  });

  const profile = await getProfile(user.id);
  return c.json(profile);
});

// Avatar lives as a data: URI in users.image — small PNG/JPEG/WEBP, client-
// side-resized before upload. Server re-validates the payload shape and the
// decoded image byte size to keep the column bounded.
const AVATAR_DATA_URI_RE = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/;
const AVATAR_MAX_DECODED_BYTES = 256 * 1024; // 256 KiB after base64-decode
const AVATAR_MAX_ENCODED_CHARS = Math.ceil(AVATAR_MAX_DECODED_BYTES * 1.4) + 64;

const avatarSchema = z.object({
  dataUri: z.string().max(AVATAR_MAX_ENCODED_CHARS),
});

meRouter.post('/v1/me/avatar', requireAuth(), async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ code: 'unauthorized', message: 'authentication required' }, 401);

  const body = await c.req.json().catch(() => null);
  const parsed = avatarSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { code: 'validation_failed', message: 'invalid request body', issues: parsed.error.issues },
      400,
    );
  }

  const match = AVATAR_DATA_URI_RE.exec(parsed.data.dataUri);
  if (!match) {
    return c.json(
      { code: 'bad_image', message: 'dataUri must be a base64 png/jpeg/webp image' },
      400,
    );
  }
  const base64 = match[2]!;
  const decodedBytes = Math.floor((base64.length * 3) / 4);
  if (decodedBytes > AVATAR_MAX_DECODED_BYTES) {
    return c.json(
      { code: 'too_large', message: `avatar must be ≤ ${AVATAR_MAX_DECODED_BYTES} bytes` },
      413,
    );
  }

  await setAvatar(user.id, parsed.data.dataUri);
  const profile = await getProfile(user.id);
  return c.json(profile);
});

meRouter.delete('/v1/me/avatar', requireAuth(), async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ code: 'unauthorized', message: 'authentication required' }, 401);
  await setAvatar(user.id, null);
  const profile = await getProfile(user.id);
  return c.json(profile);
});

const deleteAccountSchema = z.object({
  // Typed-email confirmation prevents an accidental click — the route
  // refuses unless this matches the signed-in user's address.
  confirmation: z.string().email(),
  // Optional short justification surfaced only in audit_logs for the
  // operator. Capped to a sane length so a user can't dump an essay.
  reason: z.string().min(1).max(2000).optional(),
});

meRouter.post(
  '/v1/me/delete-account',
  requireAuth(),
  // Tight rate-limit so a hijacked session can't grief: 3 attempts per
  // hour per session ip. Real deletes are once-in-a-lifetime; the limit
  // is mostly to absorb double-clicks + the typed-email retry path.
  rateLimit({
    scope: 'me-delete-account',
    limit: 3,
    windowMs: 60 * 60_000,
    key: (c) => c.req.raw.headers.get('cf-connecting-ip') ?? null,
  }),
  async (c) => {
    const user = c.get('user');
    if (!user) return c.json({ code: 'unauthorized', message: 'authentication required' }, 401);
    const body = await c.req.json().catch(() => null);
    const parsed = deleteAccountSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ code: 'validation_failed', issues: parsed.error.issues }, 400);
    }
    if (parsed.data.confirmation.toLowerCase() !== user.email.toLowerCase()) {
      return c.json(
        {
          code: 'confirmation_mismatch',
          message: 'type your email exactly as registered to confirm deletion',
        },
        400,
      );
    }
    const counts = await softDeleteAccount({
      userId: user.id,
      reason: parsed.data.reason,
    });
    // Audit-side IP hash so an operator can correlate the request with a
    // specific session if it ever needs to be reverted within the grace
    // window. The cascade summary is already on account-deletion.audit.
    await audit({
      actorId: user.id,
      projectId: null,
      action: 'account.delete_requested',
      ipHash: hashIp(c.req.raw.headers.get('cf-connecting-ip') ?? null),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: { counts },
    });
    return c.json({ deleted: true });
  },
);

const stepUpSchema = z.object({
  password: z.string().min(1).max(200),
});

/**
 * Step-up authentication. The caller re-supplies their account password;
 * on success we bump `users.last_mfa_at` to now. The `requireRecentMfa`
 * middleware on admin routes then accepts requests for the next 10 min.
 *
 * Verification delegates to Better Auth's `signInEmail` — it's the
 * supported way to validate a password without re-implementing the
 * scrypt cost params. The extra session row that Better Auth mints is
 * accepted noise for v1; the existing session continues to drive the
 * request. A real TOTP/WebAuthn upgrade is a Phase 3 follow-up.
 */
meRouter.post(
  '/v1/me/step-up',
  requireAuth(),
  rateLimit({
    scope: 'me-step-up',
    limit: 10,
    windowMs: 5 * 60_000,
    key: (c) => c.req.raw.headers.get('cf-connecting-ip') ?? null,
  }),
  async (c) => {
    const user = c.get('user');
    if (!user) return c.json({ code: 'unauthorized', message: 'authentication required' }, 401);
    const body = await c.req.json().catch(() => null);
    const parsed = stepUpSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ code: 'validation_failed', issues: parsed.error.issues }, 400);
    }
    // Delegate password verification to Better Auth. signInEmail throws
    // on bad password — treat any error as "wrong password" so we don't
    // leak whether the email exists vs whether the password's wrong.
    try {
      await auth.api.signInEmail({
        body: { email: user.email, password: parsed.data.password },
        headers: c.req.raw.headers,
      });
    } catch {
      return c.json({ code: 'invalid_credentials', message: 'password incorrect' }, 401);
    }
    const db = getDb();
    await db
      .update(users)
      .set({ lastMfaAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, user.id));
    await audit({
      actorId: user.id,
      projectId: null,
      action: 'auth.step_up',
      ipHash: hashIp(c.req.raw.headers.get('cf-connecting-ip') ?? null),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: {},
    });
    return c.json({ ok: true, validUntilMs: Date.now() + 10 * 60_000 });
  },
);
