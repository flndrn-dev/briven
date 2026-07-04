import Link from 'next/link';

import { apiJson } from '../../../../../../../lib/api';
import { DomainsForm } from './domains-form';

interface AllowedDomain {
  id: string;
  origin: string;
  isWildcard: boolean;
  createdAt: string;
}

interface DomainsResponse {
  domains: AllowedDomain[];
}

interface AuthStateResponse {
  enabled: boolean;
}

export const metadata = { title: 'auth · app domains' };
export const dynamic = 'force-dynamic';

export default async function AuthDomainsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Probe the enabled flag first (cheap) — same guard the other auth panels use.
  const state = await apiJson<AuthStateResponse>(`/v1/projects/${id}/auth/config`).catch(
    () => null,
  );

  if (!state || !state.enabled) {
    return (
      <section className="flex flex-col gap-6">
        <header>
          <h2 className="font-mono text-lg tracking-tight">auth · app domains</h2>
          <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
            enable auth on this project first.
          </p>
        </header>
        <Link
          href={`/dashboard/projects/${id}/auth`}
          className="self-start rounded-md border border-[var(--color-border)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
        >
          ← back to auth overview
        </Link>
      </section>
    );
  }

  const data = await apiJson<DomainsResponse>(
    `/v1/projects/${id}/auth/allowed-domains`,
  ).catch(() => ({ domains: [] as AllowedDomain[] }));

  return (
    <section className="flex flex-col gap-6">
      <header>
        <h2 className="font-mono text-lg tracking-tight">auth · app domains</h2>
        <p className="mt-1 max-w-2xl font-mono text-xs leading-relaxed text-[var(--color-text-muted)]">
          the websites allowed to log in through your project. add the address
          your app runs on (e.g. <code>https://yourapp.com</code>). turn on
          wildcard to also cover every subdomain (<code>https://*.yourapp.com</code>).
          only domains you register here are trusted — every other site is
          blocked, which is what keeps your users&apos; logins safe.
        </p>
      </header>

      <DomainsForm projectId={id} initial={data.domains} />
    </section>
  );
}
