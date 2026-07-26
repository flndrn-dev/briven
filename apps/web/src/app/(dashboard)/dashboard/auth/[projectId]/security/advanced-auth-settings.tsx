'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Product settings: custom JWT claims + username login (SuperTokens-class depth).
 */
export function AdvancedAuthSettings({ projectId }: { projectId: string }) {
  const [claimsJson, setClaimsJson] = useState('{\n  "tenant_plan": "pro"\n}');
  const [usernameLogin, setUsernameLogin] = useState(false);
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    const res = await fetch(
      `/api/v1/auth-core/projects/${encodeURIComponent(projectId)}/config`,
      { credentials: 'include', cache: 'no-store' },
    );
    if (!res.ok) return;
    const body = (await res.json()) as {
      jwtClaims?: Record<string, string | number | boolean>;
      usernameLogin?: boolean;
    };
    if (body.jwtClaims && Object.keys(body.jwtClaims).length > 0) {
      setClaimsJson(JSON.stringify(body.jwtClaims, null, 2));
    }
    setUsernameLogin(Boolean(body.usernameLogin));
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveClaims(): Promise<void> {
    setPending(true);
    setErr(null);
    setOk(null);
    try {
      const claims = JSON.parse(claimsJson) as Record<string, string | number | boolean>;
      const res = await fetch(
        `/api/v1/auth-core/projects/${encodeURIComponent(projectId)}/jwt-claims`,
        {
          method: 'PUT',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(claims),
        },
      );
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(b.message ?? `save failed (${res.status})`);
      }
      setOk('JWT claim template saved — applied on new ID tokens');
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'save failed');
    } finally {
      setPending(false);
    }
  }

  async function saveUsername(enabled: boolean): Promise<void> {
    setPending(true);
    setErr(null);
    setOk(null);
    try {
      const res = await fetch(
        `/api/v1/auth-core/projects/${encodeURIComponent(projectId)}/username-login`,
        {
          method: 'PUT',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ enabled }),
        },
      );
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(b.message ?? `save failed (${res.status})`);
      }
      setUsernameLogin(enabled);
      setOk(
        enabled
          ? 'username login on — users can sign in with metadata.username'
          : 'username login off — email only',
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'save failed');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-mono text-sm text-[var(--color-text)]">
          custom JWT claims
        </h3>
        <p className="mt-1 font-mono text-[11px] text-[var(--color-text-muted)]">
          Extra fields merged into OIDC ID tokens for this project (string / number /
          boolean only). Reserved claims like sub / iss are ignored.
        </p>
        <textarea
          value={claimsJson}
          onChange={(e) => setClaimsJson(e.target.value)}
          rows={6}
          spellCheck={false}
          className="mt-3 w-full max-w-lg rounded-md border bg-[var(--color-surface)] px-3 py-2 font-mono text-[11px] text-[var(--color-text)]"
          style={{ borderColor: 'var(--color-border)' }}
        />
        <button
          type="button"
          disabled={pending}
          onClick={() => void saveClaims()}
          className="mt-2 rounded-md px-3 py-1.5 font-mono text-xs font-medium text-black disabled:opacity-50"
          style={{ background: '#FFFD74' }}
        >
          {pending ? 'saving…' : 'save JWT claims'}
        </button>
      </div>

      <div>
        <h3 className="font-mono text-sm text-[var(--color-text)]">username login</h3>
        <p className="mt-1 font-mono text-[11px] text-[var(--color-text-muted)]">
          When on, email + password sign-in also accepts a username stored on the user
          (metadata.username).
        </p>
        <label className="mt-3 flex items-center gap-2 font-mono text-xs text-[var(--color-text)]">
          <input
            type="checkbox"
            checked={usernameLogin}
            disabled={pending}
            onChange={(e) => void saveUsername(e.target.checked)}
          />
          allow username as login id
        </label>
      </div>

      {ok ? (
        <p className="font-mono text-xs text-[var(--color-text)]">{ok}</p>
      ) : null}
      {err ? <p className="font-mono text-xs text-red-400">{err}</p> : null}
    </div>
  );
}
