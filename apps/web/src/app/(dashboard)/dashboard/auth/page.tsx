import Link from 'next/link';

import { loadAuthV2Workspace } from './lib/load-workspace';

export const metadata = { title: 'Briven Auth' };
export const dynamic = 'force-dynamic';

/**
 * Auth v2 home — Phase 1 live status (enable / providers / keys / domains / users).
 */
export default async function BrivenAuthHomePage() {
  const projects = await loadAuthV2Workspace();
  const enabled = projects.filter((p) => p.authEnabled && !p.error);
  const broken = projects.filter((p) => p.error);

  return (
    <section className="flex flex-col gap-6">
      <div
        className="rounded-md border p-6 md:p-8"
        style={{
          borderColor: 'var(--auth-accent-border, var(--color-border))',
          background: 'var(--color-surface-raised)',
        }}
      >
        <p
          className="font-mono text-xs uppercase tracking-widest"
          style={{ color: 'var(--auth-accent, #e6b800)' }}
        >
          phase 1 · live
        </p>
        <h2 className="mt-3 font-mono text-base text-[var(--color-text)]">
          Briven Auth control room
        </h2>
        <p className="mt-3 max-w-2xl font-mono text-xs leading-relaxed text-[var(--color-text-muted)]">
          turn login on for a project, pick sign-in methods, mint a browser key,
          allow your website address, and see users. saves re-read from the
          database so you can trust they stuck.
        </p>

        <dl className="mt-6 grid gap-3 sm:grid-cols-3">
          <div
            className="rounded-md border p-3"
            style={{ borderColor: 'var(--auth-accent-border)' }}
          >
            <dt className="font-mono text-[10px] uppercase text-[var(--color-text-muted)]">
              projects
            </dt>
            <dd className="mt-1 font-mono text-lg text-[var(--color-text)]">
              {projects.length}
            </dd>
          </div>
          <div
            className="rounded-md border p-3"
            style={{ borderColor: 'var(--auth-accent-border)' }}
          >
            <dt className="font-mono text-[10px] uppercase text-[var(--color-text-muted)]">
              Auth ON
            </dt>
            <dd className="mt-1 font-mono text-lg" style={{ color: 'var(--auth-accent)' }}>
              {enabled.length}
            </dd>
          </div>
          <div
            className="rounded-md border p-3"
            style={{ borderColor: 'var(--auth-accent-border)' }}
          >
            <dt className="font-mono text-[10px] uppercase text-[var(--color-text-muted)]">
              status issues
            </dt>
            <dd className="mt-1 font-mono text-lg text-[var(--color-text)]">{broken.length}</dd>
          </div>
        </dl>

        <ul className="mt-6 flex flex-col gap-2 font-mono text-xs">
          <li>
            <Link
              href="/dashboard/auth/projects"
              className="underline"
              style={{ color: 'var(--auth-accent)' }}
            >
              projects
            </Link>
            <span className="text-[var(--color-text-muted)]"> — enable Auth</span>
          </li>
          <li>
            <Link
              href="/dashboard/auth/providers"
              className="underline"
              style={{ color: 'var(--auth-accent)' }}
            >
              providers
            </Link>
            <span className="text-[var(--color-text-muted)]">
              {' '}
              — password / magic link / OTP / passkey (save with live proof)
            </span>
          </li>
          <li>
            <Link
              href="/dashboard/auth/security"
              className="underline"
              style={{ color: 'var(--auth-accent)' }}
            >
              security
            </Link>
            <span className="text-[var(--color-text-muted)]">
              {' '}
              — 2FA + 10 backup codes, password rules
            </span>
          </li>
          <li>
            <Link
              href="/dashboard/auth/keys"
              className="underline"
              style={{ color: 'var(--auth-accent)' }}
            >
              keys
            </Link>
            <span className="text-[var(--color-text-muted)]"> — mint pk_briven_auth_…</span>
          </li>
          <li>
            <Link
              href="/dashboard/auth/domains"
              className="underline"
              style={{ color: 'var(--auth-accent)' }}
            >
              domains
            </Link>
            <span className="text-[var(--color-text-muted)]"> — allowed app URLs</span>
          </li>
          <li>
            <Link
              href="/dashboard/auth/users"
              className="underline"
              style={{ color: 'var(--auth-accent)' }}
            >
              users
            </Link>
            <span className="text-[var(--color-text-muted)]">
              {' '}
              — end-users, linked logins, devices
            </span>
          </li>
          <li>
            <Link
              href="/dashboard/auth/sessions"
              className="underline"
              style={{ color: 'var(--auth-accent)' }}
            >
              sessions & devices
            </Link>
            <span className="text-[var(--color-text-muted)]"> — browsers + revoke sessions</span>
          </li>
        </ul>

        {enabled.length > 0 ? (
          <div className="mt-6">
            <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-text-muted)]">
              enabled now
            </p>
            <ul className="mt-2 flex flex-col gap-1 font-mono text-xs text-[var(--color-text)]">
              {enabled.map((p) => (
                <li key={p.id}>
                  {p.name}
                  {p.providers
                    ? ` · pwd ${p.providers.emailPassword ? 'ON' : 'off'} · magic ${p.providers.magicLink ? 'ON' : 'off'} · otp ${p.providers.emailOtp ? 'ON' : 'off'} · passkey ${p.providers.passkey ? 'ON' : 'off'}`
                    : ''}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="mt-6 font-mono text-xs text-[var(--color-text-muted)]">
            no project has Auth on yet — start at{' '}
            <Link href="/dashboard/auth/projects" className="underline" style={{ color: 'var(--auth-accent)' }}>
              projects
            </Link>
            .
          </p>
        )}

        <p className="mt-6 font-mono text-[10px] text-[var(--color-text-muted)]">
          login engine still uses the existing tenant path until phase 2; this
          yellow area is the config home. apps: wait for READY in{' '}
          <code className="text-[var(--color-text)]">HANDOFF-BRIVEN-AUTH-V2.md</code>.
        </p>
      </div>
    </section>
  );
}
