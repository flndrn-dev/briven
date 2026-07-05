'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { CustomOidcProvider } from './provider-toggles';

/** Which custom-OIDC providers already have an encrypted client secret on file. */
export type OidcSecretStatus = Record<string, boolean>;

interface Props {
  projectId: string;
  /** Public api origin (e.g. https://api.briven.tech) for the callback URL. */
  apiOrigin: string;
  initial: CustomOidcProvider[];
  initialSecrets: OidcSecretStatus;
}

/**
 * Generic / custom OIDC provider manager. Each provider is a self-contained
 * card: edit its public config (displayName, clientId, issuer OR explicit
 * endpoints, scopes, PKCE), rotate its write-only client secret, and copy the
 * exact upstream callback URL to register in the provider console.
 *
 * Persistence mirrors the built-in providers' split:
 *   - public config  → POST   /v1/projects/:id/auth/providers/oidc      (upsert)
 *   - client secret  → POST   /v1/projects/:id/auth/providers/oidc/:id/secret
 *   - removal        → DELETE /v1/projects/:id/auth/providers/oidc/:id
 * Every write evicts the cached Better Auth instance server-side, so changes
 * take effect on the very next sign-in.
 */
export function OidcProviders({ projectId, apiOrigin, initial, initialSecrets }: Props) {
  const router = useRouter();
  const [secretSet, setSecretSet] = useState<OidcSecretStatus>(initialSecrets);

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h3 className="font-mono text-sm text-[var(--color-text)]">custom OIDC providers</h3>
        <p className="mt-1 max-w-2xl font-mono text-[11px] leading-relaxed text-[var(--color-text-muted)]">
          add any OpenID Connect provider (Okta, Auth0, Keycloak, your own SSO).
          configure it with an issuer URL (auto-discovery) or the three explicit
          endpoints. the client secret is stored encrypted and write-only.
        </p>
      </header>

      {initial.length === 0 ? (
        <p className="font-mono text-[11px] text-[var(--color-text-subtle)]">
          no custom OIDC providers yet.
        </p>
      ) : (
        initial.map((p) => (
          <OidcCard
            key={p.id}
            projectId={projectId}
            apiOrigin={apiOrigin}
            initial={p}
            hasSecret={Boolean(secretSet[p.id])}
            onSecretSaved={(id) => setSecretSet((prev) => ({ ...prev, [id]: true }))}
            onChanged={() => router.refresh()}
          />
        ))
      )}

      <AddOidcForm
        projectId={projectId}
        existingIds={initial.map((p) => p.id)}
        onAdded={() => router.refresh()}
      />
    </div>
  );
}

const EMPTY_DRAFT: CustomOidcProvider = {
  id: '',
  displayName: '',
  enabled: false,
  clientId: null,
  issuer: null,
  authorizationUrl: null,
  tokenUrl: null,
  userinfoUrl: null,
  scopes: 'openid profile email',
  pkce: true,
};

function oidcCallbackUrl(apiOrigin: string, id: string): string {
  return `${apiOrigin}/v1/auth-tenant/oauth2/callback/${id}`;
}

/** Trim to null so empty fields persist as null (matches the API's nullable shape). */
function orNull(s: string): string | null {
  const t = s.trim();
  return t.length === 0 ? null : t;
}

interface OidcCardProps {
  projectId: string;
  apiOrigin: string;
  initial: CustomOidcProvider;
  hasSecret: boolean;
  onSecretSaved: (id: string) => void;
  onChanged: () => void;
}

function OidcCard({
  projectId,
  apiOrigin,
  initial,
  hasSecret,
  onSecretSaved,
  onChanged,
}: OidcCardProps) {
  const [draft, setDraft] = useState<CustomOidcProvider>(initial);
  const [secret, setSecret] = useState('');
  const [pending, setPending] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  function set<K extends keyof CustomOidcProvider>(key: K, val: CustomOidcProvider[K]): void {
    setDraft((prev) => ({ ...prev, [key]: val }));
  }

  async function save(): Promise<void> {
    setPending(true);
    setErrMsg(null);
    setNote(null);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/auth/providers/oidc`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(draft),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string; code?: string };
        throw new Error(body.message ?? body.code ?? `http ${res.status}`);
      }
      setNote('saved — changes are live');
      onChanged();
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'save failed');
    } finally {
      setPending(false);
    }
  }

  async function saveSecret(): Promise<void> {
    if (secret.length === 0) return;
    setPending(true);
    setErrMsg(null);
    setNote(null);
    try {
      const res = await fetch(
        `/api/v1/projects/${projectId}/auth/providers/oidc/${draft.id}/secret`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ clientSecret: secret }),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string; code?: string };
        throw new Error(body.message ?? body.code ?? `http ${res.status}`);
      }
      setSecret('');
      setNote('secret saved');
      onSecretSaved(draft.id);
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'secret save failed');
    } finally {
      setPending(false);
    }
  }

  async function remove(): Promise<void> {
    setPending(true);
    setErrMsg(null);
    try {
      const res = await fetch(
        `/api/v1/projects/${projectId}/auth/providers/oidc/${draft.id}`,
        { method: 'DELETE', credentials: 'include' },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string; code?: string };
        throw new Error(body.message ?? body.code ?? `http ${res.status}`);
      }
      onChanged();
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'delete failed');
      setPending(false);
    }
  }

  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h4 className="font-mono text-sm text-[var(--color-text)]">{draft.id}</h4>
            {hasSecret ? (
              <span className="font-mono text-[10px] text-[var(--color-primary)]">secret set ✓</span>
            ) : (
              <span className="font-mono text-[10px] text-[var(--color-text-subtle)]">
                no secret yet
              </span>
            )}
          </div>
        </div>
        <Toggle value={draft.enabled} onChange={(v) => set('enabled', v)} />
      </div>

      <div className="mt-3 flex flex-col gap-3 border-t border-[var(--color-border-subtle)] pt-3">
        <TextField
          label="display name"
          value={draft.displayName}
          onChange={(s) => set('displayName', s)}
          placeholder="Acme SSO"
        />
        <TextField
          label="client id"
          value={draft.clientId ?? ''}
          onChange={(s) => set('clientId', orNull(s))}
          placeholder="paste public client id"
        />
        <TextField
          label="issuer (OIDC discovery — leave blank to use explicit endpoints)"
          value={draft.issuer ?? ''}
          onChange={(s) => set('issuer', orNull(s))}
          placeholder="https://issuer.example.com"
        />
        <TextField
          label="authorization url"
          value={draft.authorizationUrl ?? ''}
          onChange={(s) => set('authorizationUrl', orNull(s))}
          placeholder="https://issuer.example.com/authorize"
        />
        <TextField
          label="token url"
          value={draft.tokenUrl ?? ''}
          onChange={(s) => set('tokenUrl', orNull(s))}
          placeholder="https://issuer.example.com/token"
        />
        <TextField
          label="userinfo url"
          value={draft.userinfoUrl ?? ''}
          onChange={(s) => set('userinfoUrl', orNull(s))}
          placeholder="https://issuer.example.com/userinfo"
        />
        <TextField
          label="scopes (space-separated)"
          value={draft.scopes}
          onChange={(s) => set('scopes', s)}
          placeholder="openid profile email"
        />
        <label className="flex items-center gap-2 font-mono text-[11px] text-[var(--color-text-muted)]">
          <input
            type="checkbox"
            checked={draft.pkce ?? true}
            onChange={(e) => set('pkce', e.target.checked)}
          />
          use PKCE
        </label>

        <label className="flex flex-col gap-1 font-mono text-[11px] text-[var(--color-text-muted)]">
          client secret
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={hasSecret ? 'paste a new secret to rotate' : 'paste client secret'}
            autoComplete="new-password"
            className="w-full rounded-sm border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 font-mono text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
          />
        </label>
      </div>

      <div className="mt-3 flex flex-col gap-1 border-t border-[var(--color-border-subtle)] pt-3">
        <span className="font-mono text-[10px] text-[var(--color-text-subtle)]">
          register this redirect / callback URL in the provider console:
        </span>
        <code className="select-all break-all rounded-sm border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-2 py-1 font-mono text-[11px] text-[var(--color-text)]">
          {oidcCallbackUrl(apiOrigin, draft.id)}
        </code>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={pending}
          className="rounded-md bg-[var(--color-primary)] px-3 py-1.5 font-mono text-xs font-medium text-[var(--color-text-inverse)] transition hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
        >
          {pending ? 'saving…' : 'save config'}
        </button>
        <button
          type="button"
          onClick={() => void saveSecret()}
          disabled={pending || secret.length === 0}
          className="rounded-md border border-[var(--color-border)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] transition hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] disabled:opacity-50"
        >
          save secret
        </button>
        <button
          type="button"
          onClick={() => void remove()}
          disabled={pending}
          className="rounded-md border border-[var(--color-error)]/40 px-3 py-1.5 font-mono text-xs text-[var(--color-error)] transition hover:border-[var(--color-error)] disabled:opacity-50"
        >
          delete
        </button>
        {errMsg ? (
          <span className="font-mono text-[11px] text-[var(--color-error)]">{errMsg}</span>
        ) : note ? (
          <span className="font-mono text-[11px] text-[var(--color-text-muted)]">{note}</span>
        ) : null}
      </div>
    </div>
  );
}

interface AddOidcFormProps {
  projectId: string;
  existingIds: string[];
  onAdded: () => void;
}

function AddOidcForm({ projectId, existingIds, onAdded }: AddOidcFormProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<CustomOidcProvider>(EMPTY_DRAFT);
  const [pending, setPending] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  function set<K extends keyof CustomOidcProvider>(key: K, val: CustomOidcProvider[K]): void {
    setDraft((prev) => ({ ...prev, [key]: val }));
  }

  async function create(): Promise<void> {
    if (!/^[a-z0-9-]{1,40}$/.test(draft.id)) {
      setErrMsg('id must be a slug: lowercase letters, digits, hyphens');
      return;
    }
    if (existingIds.includes(draft.id)) {
      setErrMsg('a provider with that id already exists');
      return;
    }
    setPending(true);
    setErrMsg(null);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/auth/providers/oidc`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(draft),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string; code?: string };
        throw new Error(body.message ?? body.code ?? `http ${res.status}`);
      }
      setDraft(EMPTY_DRAFT);
      setOpen(false);
      onAdded();
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'create failed');
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start rounded-md border border-[var(--color-border)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] transition hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
      >
        + add custom OIDC provider
      </button>
    );
  }

  return (
    <div className="rounded-md border border-dashed border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4">
      <h4 className="font-mono text-sm text-[var(--color-text)]">new custom OIDC provider</h4>
      <div className="mt-3 flex flex-col gap-3">
        <TextField
          label="id (slug — permanent, used in the callback URL)"
          value={draft.id}
          onChange={(s) => set('id', s)}
          placeholder="acme-sso"
        />
        <TextField
          label="display name"
          value={draft.displayName}
          onChange={(s) => set('displayName', s)}
          placeholder="Acme SSO"
        />
        <TextField
          label="client id"
          value={draft.clientId ?? ''}
          onChange={(s) => set('clientId', orNull(s))}
          placeholder="paste public client id"
        />
        <TextField
          label="issuer (or fill the three endpoints below)"
          value={draft.issuer ?? ''}
          onChange={(s) => set('issuer', orNull(s))}
          placeholder="https://issuer.example.com"
        />
        <TextField
          label="authorization url"
          value={draft.authorizationUrl ?? ''}
          onChange={(s) => set('authorizationUrl', orNull(s))}
          placeholder="https://issuer.example.com/authorize"
        />
        <TextField
          label="token url"
          value={draft.tokenUrl ?? ''}
          onChange={(s) => set('tokenUrl', orNull(s))}
          placeholder="https://issuer.example.com/token"
        />
        <TextField
          label="userinfo url"
          value={draft.userinfoUrl ?? ''}
          onChange={(s) => set('userinfoUrl', orNull(s))}
          placeholder="https://issuer.example.com/userinfo"
        />
        <TextField
          label="scopes"
          value={draft.scopes}
          onChange={(s) => set('scopes', s)}
          placeholder="openid profile email"
        />
        <p className="font-mono text-[10px] text-[var(--color-text-subtle)]">
          after saving the config, open the new card to add the client secret and
          copy the callback URL.
        </p>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => void create()}
          disabled={pending}
          className="rounded-md bg-[var(--color-primary)] px-3 py-1.5 font-mono text-xs font-medium text-[var(--color-text-inverse)] transition hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
        >
          {pending ? 'creating…' : 'create provider'}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setErrMsg(null);
          }}
          className="font-mono text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        >
          cancel
        </button>
        {errMsg ? (
          <span className="font-mono text-[11px] text-[var(--color-error)]">{errMsg}</span>
        ) : null}
      </div>
    </div>
  );
}

interface TextFieldProps {
  label: string;
  value: string;
  onChange: (s: string) => void;
  placeholder?: string;
}

function TextField({ label, value, onChange, placeholder }: TextFieldProps) {
  return (
    <label className="flex flex-col gap-1 font-mono text-[11px] text-[var(--color-text-muted)]">
      {label}
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-sm border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 font-mono text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
      />
    </label>
  );
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
          value ? 'left-6 bg-[var(--color-primary)]' : 'left-0.5 bg-[var(--color-text-subtle)]'
        }`}
      />
    </button>
  );
}
