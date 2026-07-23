import Link from 'next/link';
import { notFound } from 'next/navigation';

import { apiFetch } from '@/lib/api';
import { fetchAuthDashboard } from '../lib/auth-api';
import { loadAuthV2Workspace } from '../lib/load-workspace';

export const dynamic = 'force-dynamic';

/**
 * One project's Auth overview — counts + shortcuts.
 * Sign-in methods are managed under Providers.
 */
export default async function AuthProjectOverviewPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const projects = await loadAuthV2Workspace();
  const project = projects.find(
    (p) => p.id === projectId || p.id.toLowerCase() === projectId.toLowerCase(),
  );
  if (!project) notFound();

  const id = project.id;

  const [dash, configRes, tenantsRes] = await Promise.all([
    fetchAuthDashboard(id),
    apiFetch(`/v1/auth-core/projects/${id}/config`).catch(() => null),
    apiFetch('/v1/auth-core/tenants').catch(() => null),
  ]);

  let tenantId = project.tenantId ?? null;
  let methodsOn: string[] = [];
  let oauthConfigured: string[] = [];

  if (configRes?.ok) {
    const body = (await configRes.json()) as {
      tenantId?: string;
      methods?: Record<string, boolean>;
      providers?: Array<{ name: string; configured: boolean }>;
    };
    tenantId = body.tenantId ?? tenantId;
    if (body.methods) {
      const labels: Record<string, string> = {
        emailPassword: 'email + password',
        passwordlessEmail: 'passwordless-email',
        magicLink: 'magic-link',
        passwordlessSms: 'passwordless-sms',
        passkeys: 'passkeys',
        mfa: 'mfa',
      };
      methodsOn = Object.entries(body.methods)
        .filter(([, on]) => on)
        .map(([k]) => labels[k] ?? k);
    }
    oauthConfigured =
      body.providers?.filter((p) => p.configured).map((p) => p.name) ?? [];
  }

  let tenantRowOn = false;
  if (tenantsRes?.ok) {
    try {
      const body = (await tenantsRes.json()) as {
        tenants?: Array<{ projectId?: string; tenantId?: string }>;
        tenantIds?: string[];
      };
      const mappedTenant = tenantId;
      tenantRowOn = Boolean(
        body.tenants?.some(
          (t) =>
            t.projectId === id ||
            (t.projectId && t.projectId.toLowerCase() === id.toLowerCase()) ||
            (mappedTenant && t.tenantId === mappedTenant),
        ) ||
          (mappedTenant && body.tenantIds?.includes(mappedTenant)),
      );
    } catch {
      tenantRowOn = false;
    }
  }

  const authOn = project.authEnabled === true || tenantRowOn;

  const counts = dash.ok
    ? dash.data.counts
    : { users: 0, sessions: 0, thirdPartyLinks: 0, passwordlessCodesActive: 0 };

  return (
    <section className="space-y-6">
      {!authOn ? (
        <div className="rounded-md border border-dashed border-[var(--color-border)] p-6 font-mono text-sm text-[var(--color-text-muted)]">
          Auth is off for this project. Go back to{' '}
          <Link
            href="/dashboard/auth"
            className="underline"
            style={{ color: 'var(--auth-accent, #FFFD74)' }}
          >
            Auth home
          </Link>{' '}
          and enable it.
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'users', value: counts.users },
          { label: 'sessions', value: counts.sessions },
          { label: 'social links', value: counts.thirdPartyLinks },
          {
            label: 'active codes',
            value: counts.passwordlessCodesActive,
          },
        ].map((c) => (
          <div
            key={c.label}
            className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4"
          >
            <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-text-muted)]">
              {c.label}
            </p>
            <p className="mt-1 font-mono text-2xl text-[var(--color-text)]">
              {dash.ok ? c.value : '—'}
            </p>
          </div>
        ))}
      </div>

      <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6">
        <h2 className="font-mono text-sm text-[var(--color-text)]">
          this project
        </h2>
        <p className="mt-1 font-mono text-[11px] text-[var(--color-text-muted)]">
          tenant {tenantId ?? '—'}
        </p>
        <p className="mt-3 font-mono text-xs text-[var(--color-text-muted)]">
          methods on:{' '}
          {methodsOn.length ? methodsOn.join(', ') : 'none yet'}
          {oauthConfigured.length
            ? ` · OAuth: ${oauthConfigured.join(', ')}`
            : ''}
        </p>
        <Link
          href={`/dashboard/auth/${id}/providers`}
          className="mt-4 inline-block rounded-md px-3 py-2 font-mono text-xs font-medium text-black"
          style={{ background: '#FFFD74' }}
        >
          manage sign-in methods →
        </Link>
        <p className="mt-2 font-mono text-[10px] text-[var(--color-text-muted)]">
          open Providers to turn methods on/off and set Konnos / Google / GitHub
          client id + secret.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[
          {
            href: 'providers',
            label: 'providers',
            help: 'sign-in methods + OAuth secrets',
          },
          { href: 'users', label: 'users', help: 'app end-users' },
          { href: 'sessions', label: 'sessions', help: 'who is signed in' },
          { href: 'keys', label: 'keys', help: 'SDK keys for this app' },
          { href: 'security', label: 'security', help: 'roles' },
          { href: 'enterprise', label: 'enterprise', help: 'SAML / OIDC SSO' },
        ].map((l) => (
          <Link
            key={l.href}
            href={`/dashboard/auth/${id}/${l.href}`}
            className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 transition hover:border-[var(--color-border)]"
          >
            <p className="font-mono text-sm text-[var(--color-text)]">
              {l.label}
            </p>
            <p className="mt-1 font-mono text-[11px] text-[var(--color-text-muted)]">
              {l.help}
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}
