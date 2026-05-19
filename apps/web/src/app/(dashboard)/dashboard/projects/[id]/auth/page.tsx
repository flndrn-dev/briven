import { apiJson } from '../../../../../../lib/api';
import { EnableAuthButton } from './enable-button';

interface AuthConfig {
  providers: {
    emailPassword: { enabled: boolean };
    magicLink: { enabled: boolean; expiryMinutes: number };
    emailOtp: { enabled: boolean; codeLength: number; expiryMinutes: number };
    passkey: { enabled: boolean };
    google: { enabled: boolean; clientId: string | null };
    github: { enabled: boolean; clientId: string | null };
    discord: { enabled: boolean; clientId: string | null };
    microsoft: { enabled: boolean; clientId: string | null };
  };
  branding: {
    logoUrl: string | null;
    primaryColor: string;
    senderDomain: string | null;
    senderName: string;
  };
}

interface AuthStateResponse {
  enabled: boolean;
  config: AuthConfig;
}

export const metadata = { title: 'auth' };
export const dynamic = 'force-dynamic';

export default async function AuthOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // GET returns defaults when the project has no `auth_config` row yet, so
  // we always render something — the `enabled` flag decides which.
  const state = await apiJson<AuthStateResponse>(`/v1/projects/${id}/auth/config`).catch(
    () => null,
  );

  if (!state) {
    return (
      <section className="flex flex-col gap-6">
        <header>
          <h2 className="font-mono text-lg tracking-tight">auth</h2>
          <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
            couldn&apos;t reach the auth service — the api may be down or
            <code className="ml-1 rounded bg-[var(--color-surface-raised)] px-1">
              BRIVEN_AUTH_ENABLED
            </code>{' '}
            is off in the api env.
          </p>
        </header>
      </section>
    );
  }

  if (!state.enabled) {
    return (
      <section className="flex flex-col gap-6">
        <header>
          <h2 className="font-mono text-lg tracking-tight">auth</h2>
          <p className="mt-1 max-w-2xl font-mono text-xs leading-relaxed text-[var(--color-text-muted)]">
            drop-in authentication for your project. enable to provision the
            five <code>_briven_auth_*</code> tables in your project schema and
            unlock the providers, branding, users, audit, and webhooks panels.
            once auth is on, end-users land as queryable rows in your own
            database — joinable against any other table you own.
          </p>
        </header>

        <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-5">
          <h3 className="font-mono text-sm text-[var(--color-text)]">enable auth</h3>
          <ul className="mt-3 list-disc pl-5 font-mono text-xs leading-relaxed text-[var(--color-text-muted)]">
            <li>creates the <code>_briven_auth_users</code>, sessions, accounts, verification_tokens, audit_log tables in this project&apos;s schema</li>
            <li>installs the citext extension in this schema for case-insensitive email matching</li>
            <li>idempotent — re-running this is a safe no-op</li>
            <li>flips <code>_briven_meta.auth_enabled</code> = true</li>
          </ul>
          <div className="mt-4">
            <EnableAuthButton projectId={id} />
          </div>
        </div>
      </section>
    );
  }

  // Enabled state: show a quick summary + sub-nav placeholders. The dedicated
  // providers/branding/users/audit/etc routes land in later turns of step 5.
  const enabledProviderCount = Object.entries(state.config.providers).filter(
    ([, p]) => (p as { enabled: boolean }).enabled,
  ).length;

  return (
    <section className="flex flex-col gap-6">
      <header>
        <h2 className="font-mono text-lg tracking-tight">auth</h2>
        <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
          enabled. {enabledProviderCount} provider
          {enabledProviderCount === 1 ? '' : 's'} active.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <SummaryCard
          title="providers"
          rows={[
            ['email + password', state.config.providers.emailPassword.enabled],
            ['magic link', state.config.providers.magicLink.enabled],
            ['email otp', state.config.providers.emailOtp.enabled],
            ['passkey', state.config.providers.passkey.enabled],
            ['google', state.config.providers.google.enabled],
            ['github', state.config.providers.github.enabled],
            ['discord', state.config.providers.discord.enabled],
            ['microsoft', state.config.providers.microsoft.enabled],
          ]}
        />
        <SummaryCard
          title="branding"
          rows={[
            ['sender name', state.config.branding.senderName],
            [
              'sender domain',
              state.config.branding.senderDomain ?? 'noreply@auth.briven.tech (fallback)',
            ],
            ['primary color', state.config.branding.primaryColor],
            ['logo', state.config.branding.logoUrl ?? 'briven default'],
          ]}
        />
      </div>

      <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 font-mono text-xs text-[var(--color-text-muted)]">
        <p>
          sdk install: <code className="text-[var(--color-text)]">pnpm add @briven/auth</code>
        </p>
        <p className="mt-2">init in your app:</p>
        <pre className="mt-2 overflow-x-auto rounded-sm bg-[var(--color-surface-raised)] p-3 text-[11px]">
{`import { createBrivenAuth } from '@briven/auth';

export const auth = createBrivenAuth({
  projectId: '${id}',
  publicKey: 'pk_briven_auth_...',  // copy from the api-keys panel
});`}
        </pre>
      </div>

      <p className="font-mono text-[11px] text-[var(--color-text-subtle)]">
        providers · branding · users · audit · api-keys · webhooks · usage sub-tabs
        land progressively (BUILD_PLAN.md §13 step 5).
      </p>
    </section>
  );
}

interface SummaryCardProps {
  title: string;
  rows: Array<[string, boolean | string]>;
}

function SummaryCard({ title, rows }: SummaryCardProps) {
  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4">
      <h3 className="font-mono text-sm text-[var(--color-text)]">{title}</h3>
      <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 font-mono text-xs">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-[var(--color-text-muted)]">{k}</dt>
            <dd className="text-[var(--color-text)]">
              {typeof v === 'boolean' ? (
                v ? (
                  <span className="text-[var(--color-primary)]">on</span>
                ) : (
                  <span className="text-[var(--color-text-subtle)]">off</span>
                )
              ) : (
                v
              )}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
