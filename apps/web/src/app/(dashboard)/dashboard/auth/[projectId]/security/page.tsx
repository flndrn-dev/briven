import Link from 'next/link';

import { apiFetch } from '@/lib/api';
import { AuthRolesForm } from '../../security/roles-form';

export const metadata = { title: 'Auth · security' };
export const dynamic = 'force-dynamic';

type RoleRow = { name: string; permissions: string[]; tenantId?: string };

type MethodFlags = {
  emailPassword: boolean;
  passwordlessEmail: boolean;
  magicLink: boolean;
  passwordlessSms: boolean;
  passkeys: boolean;
  mfa: boolean;
};

const CORE_METHOD_ORDER: Array<{ key: keyof MethodFlags; label: string }> = [
  { key: 'emailPassword', label: 'email + password' },
  { key: 'passwordlessEmail', label: 'passwordless-email' },
  { key: 'magicLink', label: 'magic-link' },
  { key: 'passwordlessSms', label: 'passwordless-sms' },
  { key: 'passkeys', label: 'passkeys' },
  { key: 'mfa', label: 'mfa (TOTP)' },
];

/**
 * Security for one Auth project — roles + login methods mirroring Providers.
 */
export default async function AuthProjectSecurityPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  let roles: RoleRow[] = [];
  let rolesErr: string | null = null;
  let methods: MethodFlags | null = null;
  let oauthOn: Array<{ id: string; label: string }> = [];
  let configErr: string | null = null;

  const [rolesRes, configRes] = await Promise.all([
    apiFetch(
      `/v1/auth-core/roles?projectId=${encodeURIComponent(projectId)}`,
    ).catch(() => null),
    apiFetch(
      `/v1/auth-core/projects/${encodeURIComponent(projectId)}/config`,
    ).catch(() => null),
  ]);

  if (rolesRes) {
    if (rolesRes.status === 401) {
      rolesErr = 'sign in to briven.tech to manage roles';
    } else if (rolesRes.ok) {
      const body = (await rolesRes.json()) as {
        roles?: Array<{
          name: string;
          permissions: string[];
          tenantId?: string;
        }>;
      };
      roles = body.roles ?? [];
    } else {
      rolesErr = await rolesRes.text().catch(() => rolesRes.statusText);
    }
  }

  let smsConfigured = false;

  if (configRes?.ok) {
    const body = (await configRes.json()) as {
      methods?: MethodFlags;
      providers?: Array<{
        thirdPartyId: string;
        name: string;
        configured: boolean;
      }>;
      delivery?: { sms?: { configured?: boolean; provider?: string | null } };
    };
    methods = body.methods ?? null;
    smsConfigured = Boolean(body.delivery?.sms?.configured);
    // Only OAuth with saved secrets (same as Providers yellow · on)
    oauthOn = (body.providers ?? [])
      .filter((p) => p.configured)
      .map((p) => ({ id: p.thirdPartyId, label: p.name }));
  } else if (configRes && configRes.status === 401) {
    configErr = 'sign in to load methods';
  } else if (configRes && !configRes.ok) {
    configErr = `could not load config (${configRes.status})`;
  }

  const coreChips = CORE_METHOD_ORDER.map((m) => {
    const on = methods ? Boolean(methods[m.key]) : false;
    // passwordless-sms: show secrets gap like OAuth "configured"
    const smsGap =
      m.key === 'passwordlessSms' && on && !smsConfigured
        ? ' · needs Twilio'
        : m.key === 'passwordlessSms' && on && smsConfigured
          ? ' · Twilio ready'
          : '';
    return {
      id: m.key,
      label: m.label,
      on,
      extra: smsGap,
    };
  });
  const smsReady = Boolean(methods?.passwordlessSms && smsConfigured);

  return (
    <section className="space-y-8">
      <header>
        <h2 className="font-mono text-lg tracking-tight text-[var(--color-text)]">
          security
        </h2>
        <p className="mt-1 font-mono text-sm text-[var(--color-text-muted)]">
          roles for this project&apos;s app users
        </p>
      </header>

      <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6">
        <h3 className="font-mono text-sm text-[var(--color-text)]">
          login methods
        </h3>
        <p className="mt-1 font-mono text-[11px] text-[var(--color-text-muted)]">
          same as Providers · yellow = on · change under Providers
        </p>
        {configErr ? (
          <p className="mt-3 font-mono text-xs text-[var(--color-text-muted)]">
            {configErr}
          </p>
        ) : (
          <>
            <p className="mt-3 font-mono text-[10px] uppercase tracking-widest text-[var(--color-text-muted)]">
              sign-in methods
            </p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {coreChips.map((c) => (
                <li
                  key={c.id}
                  className="rounded border px-2 py-1 font-mono text-[11px]"
                  style={
                    c.on
                      ? {
                          borderColor: 'var(--auth-accent-border, #FFFD74)',
                          background: 'var(--auth-accent-soft)',
                          color: 'var(--color-text)',
                        }
                      : {
                          borderColor: 'var(--color-border-subtle)',
                          color: 'var(--color-text-muted)',
                          opacity: 0.55,
                        }
                  }
                >
                  {c.label}
                  {c.on ? '' : ' · off'}
                  {c.extra}
                </li>
              ))}
            </ul>

            <p className="mt-4 font-mono text-[10px] uppercase tracking-widest text-[var(--color-text-muted)]">
              SMS (Twilio)
            </p>
            <p className="mt-2 font-mono text-[11px] text-[var(--color-text-muted)]">
              {smsReady
                ? 'ready — passwordless-sms on + secrets saved'
                : methods?.passwordlessSms && !smsConfigured
                  ? 'method on, but secrets not set — open Providers → SMS'
                  : smsConfigured && !methods?.passwordlessSms
                    ? 'secrets saved, method off — turn on passwordless-sms under Providers'
                    : 'not ready — enable passwordless-sms and save Twilio under Providers'}
              {' · '}
              <Link
                href={`/dashboard/auth/${projectId}/providers?method=passwordlessSms#auth-sms-setup`}
                className="underline"
                style={{ color: 'var(--auth-accent, #FFFD74)' }}
              >
                manage SMS
              </Link>
            </p>

            <p className="mt-4 font-mono text-[10px] uppercase tracking-widest text-[var(--color-text-muted)]">
              OAuth (secrets saved)
            </p>
            {oauthOn.length === 0 ? (
              <p className="mt-2 font-mono text-[11px] text-[var(--color-text-muted)]">
                none yet — save client id + secret under Providers
              </p>
            ) : (
              <ul className="mt-2 flex flex-wrap gap-2">
                {oauthOn.map((c) => (
                  <li
                    key={c.id}
                    className="rounded border px-2 py-1 font-mono text-[11px]"
                    style={{
                      borderColor: 'var(--auth-accent-border, #FFFD74)',
                      background: 'var(--auth-accent-soft)',
                      color: 'var(--color-text)',
                    }}
                  >
                    {c.label}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6">
        <h3 className="font-mono text-sm text-[var(--color-text)]">roles</h3>
        {!rolesErr ? <AuthRolesForm projectId={projectId} /> : null}
        {rolesErr ? (
          <p className="mt-3 font-mono text-xs text-[var(--color-text-muted)]">
            {rolesErr}
          </p>
        ) : roles.length === 0 ? (
          <p className="mt-3 font-mono text-xs text-[var(--color-text-muted)]">
            no roles yet for this project
          </p>
        ) : (
          <ul className="mt-4 space-y-2 font-mono text-xs">
            {roles.map((r) => (
              <li
                key={r.name}
                className="rounded border border-[var(--color-border-subtle)] px-3 py-2"
              >
                <span className="text-[var(--color-text)]">{r.name}</span>
                {r.permissions?.length ? (
                  <span className="ml-2 text-[var(--color-text-muted)]">
                    {r.permissions.join(', ')}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
