'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export interface AuthConfig {
  providers: {
    emailPassword: { enabled: boolean };
    magicLink: { enabled: boolean; expiryMinutes: number };
    emailOtp: { enabled: boolean; codeLength: number; expiryMinutes: number };
    passkey: { enabled: boolean };
    google: { enabled: boolean; clientId: string | null };
    github: { enabled: boolean; clientId: string | null };
    discord: { enabled: boolean; clientId: string | null };
    microsoft: { enabled: boolean; clientId: string | null };
    konnos: { enabled: boolean; clientId: string | null };
  };
  branding: {
    logoUrl: string | null;
    primaryColor: string;
    senderDomain: string | null;
    senderName: string;
  };
}

/**
 * One tenant-defined custom OIDC provider (the generic escape hatch next
 * to the built-in google/github/discord/microsoft toggles). Mirrors the
 * API's nullable shape; `scopes` is the raw space-separated string.
 */
export interface CustomOidcProvider {
  id: string;
  displayName: string;
  enabled: boolean;
  clientId: string | null;
  issuer: string | null;
  authorizationUrl: string | null;
  tokenUrl: string | null;
  userinfoUrl: string | null;
  scopes: string;
  pkce: boolean | null;
}

interface Props {
  projectId: string;
  initial: AuthConfig;
}

type OAuthKey = 'konnos' | 'google' | 'github' | 'discord' | 'microsoft';
const OAUTH_KEYS: OAuthKey[] = ['konnos', 'google', 'github', 'discord', 'microsoft'];

/**
 * Client-side editor for the Providers panel. Local state holds the
 * working copy; `save` PATCHes the API with the full `providers` block
 * (server-side zod merge handles partial → full). On success, the api
 * evicts the cached Better Auth instance, so the next sign-in uses the
 * updated provider set.
 *
 * OAuth client SECRETS aren't editable here — they need the encrypted
 * tenant-secrets persistence layer (BUILD_PLAN.md §6 + ARCHITECTURE.md §4)
 * which lands in a follow-up turn. For now the panel surfaces the public
 * client id only, with a note that secrets land separately.
 */
export function ProviderToggles({ projectId, initial }: Props) {
  const router = useRouter();
  const [providers, setProviders] = useState(initial.providers);
  const [pending, setPending] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  async function save(): Promise<void> {
    setPending(true);
    setErrMsg(null);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/auth/config`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ providers }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          code?: string;
          message?: string;
        };
        throw new Error(body.message ?? body.code ?? `http ${res.status}`);
      }
      const body = (await res.json()) as { config: AuthConfig };
      setProviders(body.config.providers);
      setSavedAt(Date.now());
      router.refresh();
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'save failed');
    } finally {
      setPending(false);
    }
  }

  function update<K extends keyof AuthConfig['providers']>(
    key: K,
    patch: Partial<AuthConfig['providers'][K]>,
  ): void {
    setProviders((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }

  return (
    <div className="flex flex-col gap-4">
      <ProviderCard
        title="email + password"
        description="classic password sign-up + sign-in. argon2id hashing. password reset via email."
        enabled={providers.emailPassword.enabled}
        onToggle={(v) => update('emailPassword', { enabled: v })}
      />

      <ProviderCard
        title="magic link"
        description="email contains a one-shot sign-in link. no password required."
        enabled={providers.magicLink.enabled}
        onToggle={(v) => update('magicLink', { enabled: v })}
      >
        <NumberField
          label="expiry (minutes)"
          min={1}
          max={60}
          value={providers.magicLink.expiryMinutes}
          onChange={(n) => update('magicLink', { expiryMinutes: n })}
        />
      </ProviderCard>

      <ProviderCard
        title="email otp"
        description="email contains a numeric code; user pastes it back into the app."
        enabled={providers.emailOtp.enabled}
        onToggle={(v) => update('emailOtp', { enabled: v })}
      >
        <NumberField
          label="code length"
          min={4}
          max={8}
          value={providers.emailOtp.codeLength}
          onChange={(n) => update('emailOtp', { codeLength: n })}
        />
        <NumberField
          label="expiry (minutes)"
          min={1}
          max={30}
          value={providers.emailOtp.expiryMinutes}
          onChange={(n) => update('emailOtp', { expiryMinutes: n })}
        />
      </ProviderCard>

      <ProviderCard
        title="passkey (WebAuthn)"
        description="hardware-backed credentials per device. supported on Chrome, Safari, Firefox."
        enabled={providers.passkey.enabled}
        onToggle={(v) => update('passkey', { enabled: v })}
      />

      <div className="mt-2 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3 font-mono text-[11px] text-[var(--color-text-muted)]">
        OAuth client SECRETS rotate through a separate encrypted endpoint
        (BUILD_PLAN.md §6 + ARCHITECTURE.md §4). that endpoint lands in the
        next iteration — for now you can paste client ids here, save, and
        come back later to set the secret. providers stay disabled at the
        engine until both halves are present.
      </div>

      {OAUTH_KEYS.map((key) => (
        <OAuthCard
          key={key}
          name={key}
          value={providers[key]}
          onToggle={(v) => update(key, { enabled: v })}
          onClientId={(s) => update(key, { clientId: s.length === 0 ? null : s })}
        />
      ))}

      <div className="flex items-center gap-3 pt-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={pending}
          className="rounded-md bg-[var(--color-primary)] px-4 py-2 font-mono text-xs font-medium text-[var(--color-text-inverse)] transition hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
        >
          {pending ? 'saving…' : 'save providers'}
        </button>
        {errMsg ? (
          <span className="font-mono text-xs text-[var(--color-error)]">{errMsg}</span>
        ) : savedAt ? (
          <span className="font-mono text-[11px] text-[var(--color-text-muted)]">
            saved · pool invalidated
          </span>
        ) : null}
      </div>
    </div>
  );
}

interface ProviderCardProps {
  title: string;
  description: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  children?: React.ReactNode;
}

function ProviderCard({ title, description, enabled, onToggle, children }: ProviderCardProps) {
  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <h3 className="font-mono text-sm text-[var(--color-text)]">{title}</h3>
          <p className="mt-1 font-mono text-[11px] text-[var(--color-text-muted)]">{description}</p>
        </div>
        <Toggle value={enabled} onChange={onToggle} />
      </div>
      {children ? (
        <div className="mt-3 flex flex-wrap gap-3 border-t border-[var(--color-border-subtle)] pt-3">
          {children}
        </div>
      ) : null}
    </div>
  );
}

interface OAuthCardProps {
  name: OAuthKey;
  value: { enabled: boolean; clientId: string | null };
  onToggle: (v: boolean) => void;
  onClientId: (s: string) => void;
}

function OAuthCard({ name, value, onToggle, onClientId }: OAuthCardProps) {
  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <h3 className="font-mono text-sm text-[var(--color-text)]">{name}</h3>
          <p className="mt-1 font-mono text-[11px] text-[var(--color-text-muted)]">
            OAuth 2.0 with PKCE. paste the public client id from{' '}
            <span className="text-[var(--color-text)]">{providerConsoleUrl(name)}</span>.
          </p>
        </div>
        <Toggle value={value.enabled} onChange={onToggle} />
      </div>
      <div className="mt-3 flex flex-wrap gap-3 border-t border-[var(--color-border-subtle)] pt-3">
        <label className="flex flex-col gap-1 font-mono text-[11px] text-[var(--color-text-muted)]">
          client id
          <input
            type="text"
            value={value.clientId ?? ''}
            onChange={(e) => onClientId(e.target.value)}
            placeholder="paste public client id"
            className="w-80 rounded-sm border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 font-mono text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
          />
        </label>
        <p className="self-end pb-1 font-mono text-[11px] text-[var(--color-text-subtle)]">
          client secret: configure separately (encrypted endpoint)
        </p>
      </div>
    </div>
  );
}

function providerConsoleUrl(name: OAuthKey): string {
  switch (name) {
    case 'konnos':
      return 'code.konnos.org → Settings → Applications';
    case 'google':
      return 'console.cloud.google.com → APIs & Services → Credentials';
    case 'github':
      return 'github.com/settings/developers → OAuth Apps';
    case 'discord':
      return 'discord.com/developers/applications';
    case 'microsoft':
      return 'portal.azure.com → Entra ID → App registrations';
  }
}

interface ToggleProps {
  value: boolean;
  onChange: (v: boolean) => void;
}

function Toggle({ value, onChange }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
      className={`relative h-6 w-11 shrink-0 rounded-full border transition ${
        value
          ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/20'
          : 'border-[var(--color-border)] bg-[var(--color-surface)]'
      }`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full transition ${
          value
            ? 'left-6 bg-[var(--color-primary)]'
            : 'left-0.5 bg-[var(--color-text-subtle)]'
        }`}
      />
    </button>
  );
}

interface NumberFieldProps {
  label: string;
  min: number;
  max: number;
  value: number;
  onChange: (n: number) => void;
}

function NumberField({ label, min, max, value, onChange }: NumberFieldProps) {
  return (
    <label className="flex flex-col gap-1 font-mono text-[11px] text-[var(--color-text-muted)]">
      {label}
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
        className="w-24 rounded-sm border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 font-mono text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
      />
    </label>
  );
}
