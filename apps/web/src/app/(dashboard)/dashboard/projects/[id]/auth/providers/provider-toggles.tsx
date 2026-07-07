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

type OAuthKey = 'konnos' | 'google' | 'github' | 'discord' | 'microsoft';
const OAUTH_KEYS: OAuthKey[] = ['konnos', 'google', 'github', 'discord', 'microsoft'];

/**
 * Presence-only secret status per built-in provider (booleans, never values).
 * Sourced from the config GET's `secretSet` map — the API never returns the
 * stored secret, so the UI only ever knows "is one set?".
 */
export type SocialSecretStatus = Partial<Record<OAuthKey, boolean>>;

interface Props {
  projectId: string;
  initial: AuthConfig;
  initialSecrets: SocialSecretStatus;
}

/**
 * Client-side editor for the Providers panel. Local state holds the
 * working copy; `save` PATCHes the API with the full `providers` block
 * (server-side zod merge handles partial → full). On success, the api
 * evicts the cached Better Auth instance, so the next sign-in uses the
 * updated provider set.
 *
 * Each OAuth card carries two independent saves: the public client id rides
 * the bulk config PATCH (`save`), while the write-only client SECRET goes to
 * its own encrypted endpoint (PUT .../providers/:provider/secret) per card.
 * The API never returns a stored secret — it only reports presence via the
 * `secretSet` map on the config GET, surfaced here as a "secret set ✓" tick.
 */
export function ProviderToggles({ projectId, initial, initialSecrets }: Props) {
  const router = useRouter();
  const [providers, setProviders] = useState(initial.providers);
  const [secretSet, setSecretSet] = useState<SocialSecretStatus>(initialSecrets);
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
        <p className="mt-2 font-mono text-[11px] text-[var(--color-text-subtle)]">
          emails send from the sender name + domain configured in auth
          &rarr; branding.
        </p>
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
        <p className="mt-2 font-mono text-[11px] text-[var(--color-text-subtle)]">
          emails send from the sender name + domain configured in auth
          &rarr; branding.
        </p>
      </ProviderCard>

      <ProviderCard
        title="passkey (WebAuthn)"
        description="hardware-backed credentials per device. supported on Chrome, Safari, Firefox."
        enabled={providers.passkey.enabled}
        onToggle={(v) => update('passkey', { enabled: v })}
      />

      <div className="mt-2 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3 font-mono text-[11px] text-[var(--color-text-muted)]">
        each provider needs both halves: paste the public client id and hit
        “save providers”, then set the client secret on the same card (it goes
        to a separate encrypted endpoint and is write-only — it’s never shown
        back). providers stay disabled at the engine until both are present.
      </div>

      {OAUTH_KEYS.map((key) => (
        <OAuthCard
          key={key}
          projectId={projectId}
          name={key}
          value={providers[key]}
          hasSecret={Boolean(secretSet[key])}
          onToggle={(v) => update(key, { enabled: v })}
          onClientId={(s) => update(key, { clientId: s.length === 0 ? null : s })}
          onSecretSaved={() => setSecretSet((prev) => ({ ...prev, [key]: true }))}
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
            saved — changes are live
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
  projectId: string;
  name: OAuthKey;
  value: { enabled: boolean; clientId: string | null };
  hasSecret: boolean;
  onToggle: (v: boolean) => void;
  onClientId: (s: string) => void;
  onSecretSaved: () => void;
}

function OAuthCard({
  projectId,
  name,
  value,
  hasSecret,
  onToggle,
  onClientId,
  onSecretSaved,
}: OAuthCardProps) {
  const [secret, setSecret] = useState('');
  const [pending, setPending] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function saveSecret(): Promise<void> {
    // Empty input means "keep the existing secret" — never send it.
    if (secret.length === 0) return;
    setPending(true);
    setErrMsg(null);
    setNote(null);
    try {
      const res = await fetch(
        `/api/v1/projects/${projectId}/auth/providers/${name}/secret`,
        {
          method: 'PUT',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ secret }),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string; code?: string };
        throw new Error(body.message ?? body.code ?? `http ${res.status}`);
      }
      setSecret('');
      setNote('secret saved — now live');
      onSecretSaved();
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'secret save failed');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-mono text-sm text-[var(--color-text)]">{name}</h3>
            {hasSecret ? (
              <span className="font-mono text-[10px] text-[var(--color-primary)]">secret set ✓</span>
            ) : (
              <span className="font-mono text-[10px] text-[var(--color-text-subtle)]">
                no secret yet
              </span>
            )}
          </div>
          <p className="mt-1 font-mono text-[11px] text-[var(--color-text-muted)]">
            OAuth 2.0 with PKCE. paste the public client id from{' '}
            <span className="text-[var(--color-text)]">{providerConsoleUrl(name)}</span>.
          </p>
        </div>
        <Toggle value={value.enabled} onChange={onToggle} />
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-[var(--color-border-subtle)] pt-3">
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
        <label className="flex flex-col gap-1 font-mono text-[11px] text-[var(--color-text-muted)]">
          client secret
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={hasSecret ? 'replace secret (leave blank to keep)' : 'paste client secret'}
            autoComplete="new-password"
            className="w-80 rounded-sm border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 font-mono text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
          />
        </label>
        <button
          type="button"
          onClick={() => void saveSecret()}
          disabled={pending || secret.length === 0}
          className="rounded-md border border-[var(--color-border)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] transition hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] disabled:opacity-50"
        >
          {pending ? 'saving…' : 'save secret'}
        </button>
        {errMsg ? (
          <span className="self-center font-mono text-[11px] text-[var(--color-error)]">{errMsg}</span>
        ) : note ? (
          <span className="self-center font-mono text-[11px] text-[var(--color-text-muted)]">
            {note}
          </span>
        ) : null}
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
