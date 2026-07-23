import { apiFetch } from '@/lib/api';
import { fetchAuthCoreInfo } from '../../lib/auth-api';
import { AuthRolesForm } from '../../security/roles-form';

export const metadata = { title: 'Auth · security' };
export const dynamic = 'force-dynamic';

type RoleRow = { name: string; permissions: string[]; tenantId?: string };

export default async function AuthProjectSecurityPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const info = await fetchAuthCoreInfo();
  let roles: RoleRow[] = [];
  let rolesErr: string | null = null;

  try {
    const res = await apiFetch(
      `/v1/auth-core/roles?projectId=${encodeURIComponent(projectId)}`,
    );
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
        <h2 className="font-mono text-lg tracking-tight text-[var(--color-text)]">
          security
        </h2>
        <p className="mt-1 font-mono text-sm text-[var(--color-text-muted)]">
          roles for this project&apos;s app users
        </p>
      </header>

      <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6">
        <h3 className="font-mono text-sm text-[var(--color-text)]">
          login methods (platform)
        </h3>
        <ul className="mt-3 flex flex-wrap gap-2">
          {methods.map((m) => (
            <li
              key={m}
              className="rounded border px-2 py-1 font-mono text-[11px]"
              style={{
                borderColor: 'var(--auth-accent-border)',
                background: 'var(--auth-accent-soft)',
              }}
            >
              {m}
            </li>
          ))}
        </ul>
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
