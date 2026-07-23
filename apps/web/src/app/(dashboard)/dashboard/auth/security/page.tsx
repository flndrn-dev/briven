import { apiFetch } from '@/lib/api';
import { fetchAuthCoreInfo } from '../lib/auth-api';
import { AuthRolesForm } from './roles-form';

export const metadata = { title: 'Auth · security' };
export const dynamic = 'force-dynamic';

type RoleRow = { name: string; permissions: string[]; tenantId?: string };

/**
 * Yellow Auth security — roles + methods summary (Phase 6).
 */
export default async function AuthSecurityPage() {
  const info = await fetchAuthCoreInfo();
  let roles: RoleRow[] = [];
  let rolesErr: string | null = null;

  try {
    const res = await apiFetch('/v1/auth-core/roles');
    if (res.status === 401) {
      rolesErr = 'sign in to briven.tech to manage roles';
    } else if (res.ok) {
      const body = (await res.json()) as {
        roles?: Array<{ name: string; permissions: string[]; tenantId?: string }>;
      };
      roles = body.roles ?? [];
    } else {
      rolesErr = await res.text().catch(() => res.statusText);
    }
  } catch (e) {
    rolesErr = e instanceof Error ? e.message : String(e);
  }

  const methods = info?.loginMethods ?? [];

  return (
    <section className="space-y-8">
      <header>
        <h1 className="font-mono text-xl tracking-tight text-[var(--color-text)]">
          security
        </h1>
        <p className="mt-1 font-mono text-sm text-[var(--color-text-muted)]">
          login methods and roles for app users
        </p>
      </header>

      <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6">
        <h2 className="font-mono text-sm text-[var(--color-text)]">
          login methods live
        </h2>
        {methods.length === 0 ? (
          <p className="mt-2 font-mono text-xs text-[var(--color-text-muted)]">
            no methods reported yet
          </p>
        ) : (
          <ul className="mt-3 flex flex-wrap gap-2">
            {methods.map((m) => (
              <li
                key={m}
                className="rounded border border-[var(--color-border-subtle)] px-2 py-1 font-mono text-[11px] text-[var(--color-text)]"
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
        <p className="mt-4 font-mono text-[11px] text-[var(--color-text-muted)]">
          MFA: after password, enrolled users get MFA_REQUIRED then TOTP verify.
          Passkeys: /v1/auth-core/fdi/webauthn/*
        </p>
      </div>

      <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6">
        <h2 className="font-mono text-sm text-[var(--color-text)]">roles</h2>
        <p className="mt-1 font-mono text-[11px] text-[var(--color-text-muted)]">
          name a role and optional permissions for app users
        </p>
        {!rolesErr ? <AuthRolesForm /> : null}
        {rolesErr ? (
          <p className="mt-3 font-mono text-xs text-[var(--color-text-muted)]">
            {rolesErr}
          </p>
        ) : roles.length === 0 ? (
          <p className="mt-3 font-mono text-xs text-[var(--color-text-muted)]">
            no roles yet — use the form above
          </p>
        ) : (
          <ul className="mt-4 space-y-2 font-mono text-xs">
            {roles.map((r) => (
              <li
                key={`${r.tenantId ?? 'public'}:${r.name}`}
                className="rounded border border-[var(--color-border-subtle)] px-3 py-2"
              >
                <span className="text-[var(--color-text)]">{r.name}</span>
                {r.tenantId ? (
                  <span className="ml-2 text-[var(--color-text-muted)]">
                    · {r.tenantId}
                  </span>
                ) : null}
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
