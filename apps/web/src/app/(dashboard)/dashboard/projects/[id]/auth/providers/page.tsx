import Link from 'next/link';

import { apiJson } from '../../../../../../../lib/api';
import { apiOrigin } from '../../../../../../../lib/env';
import { OidcProviders, type OidcSecretStatus } from './oidc-providers';
import { ProviderToggles, type AuthConfig, type SecretStatus } from './provider-toggles';

interface AuthStateResponse {
  enabled: boolean;
  config: AuthConfig;
}

interface SecretStatusResponse {
  secrets: SecretStatus;
  oidc?: OidcSecretStatus;
}

const EMPTY_SECRETS: SecretStatus = {
  google: false,
  github: false,
  discord: false,
  microsoft: false,
  konnos: false,
};

export const metadata = { title: 'auth · providers' };
export const dynamic = 'force-dynamic';

export default async function AuthProvidersPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const state = await apiJson<AuthStateResponse>(`/v1/projects/${id}/auth/config`).catch(
    () => null,
  );

  if (!state || !state.enabled) {
    return (
      <section className="flex flex-col gap-6">
        <header>
          <h2 className="font-mono text-lg tracking-tight">auth · providers</h2>
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

  // Which providers already have an encrypted secret on file. Write-only —
  // the API never returns the secret itself, just a per-provider boolean.
  // Fetched alongside the config (same server-side pattern) so the cards can
  // render "secret set ✓" without a client-side loading flash.
  const secretStatus = await apiJson<SecretStatusResponse>(
    `/v1/projects/${id}/auth/providers/secret-status`,
  ).catch(() => null);
  const initialSecrets = secretStatus?.secrets ?? EMPTY_SECRETS;
  const initialOidcSecrets: OidcSecretStatus = secretStatus?.oidc ?? {};
  const customOidc = state.config.customOidc ?? [];

  return (
    <section className="flex flex-col gap-6">
      <header>
        <h2 className="font-mono text-lg tracking-tight">auth · providers</h2>
        <p className="mt-1 max-w-2xl font-mono text-xs leading-relaxed text-[var(--color-text-muted)]">
          flip the sign-in methods your customers can use. changes take effect
          on the very next sign-in request — the cached Better Auth instance
          for this project is evicted on save, so the next request rebuilds
          with the new config.
        </p>
      </header>

      <ProviderToggles
        projectId={id}
        apiOrigin={apiOrigin}
        initial={state.config}
        initialSecrets={initialSecrets}
      />

      <div className="border-t border-[var(--color-border-subtle)] pt-6">
        <OidcProviders
          projectId={id}
          apiOrigin={apiOrigin}
          initial={customOidc}
          initialSecrets={initialOidcSecrets}
        />
      </div>
    </section>
  );
}
