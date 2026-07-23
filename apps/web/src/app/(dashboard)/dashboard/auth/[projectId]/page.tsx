import Link from 'next/link';
import { notFound } from 'next/navigation';

import { apiFetch } from '@/lib/api';
import {
  fetchAuthCoreInfo,
  fetchAuthDashboard,
} from '../lib/auth-api';
import { loadAuthV2Workspace } from '../lib/load-workspace';

export const dynamic = 'force-dynamic';

/**
 * One project's Auth overview — counts + methods for this tenant only.
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

  const [info, dash, configRes, tenantsRes] = await Promise.all([
    fetchAuthCoreInfo(),
    fetchAuthDashboard(id),
    apiFetch(`/v1/auth-core/projects/${id}/config`).catch(() => null),
    apiFetch('/v1/auth-core/tenants').catch(() => null),
  ]);

  let configOk = false;
  let tenantId = project.tenantId ?? null;
  let providerSummary: Array<{ name: string; configured: boolean }> = [];
  if (configRes?.ok) {
    configOk = true;
    const body = (await configRes.json()) as {
      tenantId?: string;
      providers?: Array<{ name: string; configured: boolean }>;
    };
    tenantId = body.tenantId ?? tenantId;
    providerSummary = body.providers ?? [];
  }

  // Second source of truth: live be_tenants list (catches workspace lag / SQL miss).
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
  const methods = info?.loginMethods ?? [];

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
        <p className="mt-2 font-mono text-xs text-[var(--color-text-muted)]">
          tenant {tenantId ?? '—'}
          {configOk ? ' · config loaded' : ''}
        </p>
        {providerSummary.length > 0 ? (
          <ul className="mt-3 flex flex-wrap gap-2">
            {providerSummary.map((p) => (
              <li
                key={p.name}
                className="rounded border px-2 py-1 font-mono text-[11px] text-[var(--color-text)]"
                style={{
                  borderColor: 'var(--auth-accent-border)',
                  background: p.configured
                    ? 'var(--auth-accent-soft)'
                    : 'transparent',
                }}
              >
                {p.name}
                {p.configured ? '' : ' · not set'}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6">
        <h2 className="font-mono text-sm text-[var(--color-text)]">
          platform methods live
        </h2>
        {methods.length === 0 ? (
          <p className="mt-2 font-mono text-xs text-[var(--color-text-muted)]">
            none reported
          </p>
        ) : (
          <ul className="mt-3 flex flex-wrap gap-2">
            {methods.map((m) => (
              <li
                key={m}
                className="rounded border px-2 py-1 font-mono text-[11px] text-[var(--color-text)]"
                style={{
                  borderColor: 'var(--auth-accent-border)',
                  background: 'var(--auth-accent-soft)',
                }}
              >
                {m}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[
          { href: 'users', label: 'users', help: 'app end-users' },
          { href: 'sessions', label: 'sessions', help: 'who is signed in' },
          { href: 'keys', label: 'keys', help: 'SDK keys for this app' },
          { href: 'providers', label: 'providers', help: 'Google, GitHub, …' },
          { href: 'security', label: 'security', help: 'roles' },
          { href: 'enterprise', label: 'enterprise', help: 'SAML / OIDC SSO' },
        ].map((l) => (
          <Link
            key={l.href}
            href={`/dashboard/auth/${projectId}/${l.href}`}
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
