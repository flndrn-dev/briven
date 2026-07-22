'use client';

import { useCallback, useEffect, useState } from 'react';

import type { AuthV2ProjectRow } from '../lib/auth-v2-types';

interface TwoFactorState {
  enabled: boolean;
  required: boolean;
  backupCodeCount: number;
}

interface PasswordPolicyState {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumber: boolean;
  requireSpecial: boolean;
  maxAgeDays: number | null;
  preventReuse: number;
}

const DEFAULT_POLICY: PasswordPolicyState = {
  minLength: 8,
  requireUppercase: false,
  requireLowercase: false,
  requireNumber: false,
  requireSpecial: false,
  maxAgeDays: null,
  preventReuse: 0,
};

export function AuthSecurityClient({ projects }: { projects: AuthV2ProjectRow[] }) {
  const enabledProjects = projects.filter((p) => p.authEnabled);
  const [projectId, setProjectId] = useState(enabledProjects[0]?.id ?? '');
  const [twoFactor, setTwoFactor] = useState<TwoFactorState>({
    enabled: false,
    required: false,
    backupCodeCount: 0,
  });
  const [policy, setPolicy] = useState<PasswordPolicyState>(DEFAULT_POLICY);
  const [inactivityMinutes, setInactivityMinutes] = useState(0);
  const [pendingTf, setPendingTf] = useState(false);
  const [pendingPolicy, setPendingPolicy] = useState(false);
  const [pendingSession, setPendingSession] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [proof, setProof] = useState<string | null>(null);

  const load = useCallback(async (id: string) => {
    if (!id) return;
    setErr(null);
    setProof(null);
    const [snapRes, cfgRes] = await Promise.all([
      fetch(`/api/v1/auth-v2/projects/${id}/snapshot`, { credentials: 'include' }),
      fetch(`/api/v1/projects/${id}/auth/config`, { credentials: 'include' }),
    ]);
    if (!snapRes.ok) {
      const body = (await snapRes.json().catch(() => ({}))) as { message?: string };
      setErr(body.message ?? `could not load (${snapRes.status})`);
      return;
    }
    const body = (await snapRes.json()) as {
      twoFactor?: TwoFactorState | null;
      passwordPolicy?: PasswordPolicyState | null;
    };
    if (body.twoFactor) setTwoFactor(body.twoFactor);
    else setTwoFactor({ enabled: false, required: false, backupCodeCount: 0 });
    if (body.passwordPolicy) setPolicy(body.passwordPolicy);
    else setPolicy(DEFAULT_POLICY);
    if (cfgRes.ok) {
      const cfg = (await cfgRes.json()) as {
        config?: { session?: { inactivityTimeoutMinutes?: number } };
      };
      setInactivityMinutes(cfg.config?.session?.inactivityTimeoutMinutes ?? 0);
    }
  }, []);

  useEffect(() => {
    if (projectId) void load(projectId);
  }, [projectId, load]);

  async function saveSession(): Promise<void> {
    if (!projectId) return;
    setPendingSession(true);
    setErr(null);
    setProof(null);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/auth/config`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          session: { inactivityTimeoutMinutes: inactivityMinutes },
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        message?: string;
        config?: { session?: { inactivityTimeoutMinutes?: number } };
      };
      if (!res.ok) throw new Error(body.message ?? `http ${res.status}`);
      const mins = body.config?.session?.inactivityTimeoutMinutes ?? inactivityMinutes;
      setInactivityMinutes(mins);
      setProof(
        mins > 0
          ? `session timeout saved — ${mins} minute${mins === 1 ? '' : 's'} of idle`
          : 'session timeout saved — never expire for idle',
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'session save failed');
    } finally {
      setPendingSession(false);
    }
  }

  async function saveTwoFactor(): Promise<void> {
    if (!projectId) return;
    setPendingTf(true);
    setErr(null);
    setProof(null);
    try {
      const res = await fetch(`/api/v1/auth-v2/projects/${projectId}/two-factor`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          enabled: twoFactor.enabled,
          required: twoFactor.required,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        message?: string;
        proof?: TwoFactorState;
        twoFactor?: TwoFactorState;
        savedAt?: string;
      };
      if (!res.ok) throw new Error(body.message ?? `http ${res.status}`);
      const live = body.proof ?? body.twoFactor;
      if (live) setTwoFactor(live);
      setProof(
        `2FA saved ${body.savedAt ?? 'ok'} — ${live?.enabled ? 'ON' : 'OFF'}` +
          (live?.enabled
            ? ` · required ${live.required ? 'yes' : 'no'} · ${live.backupCodeCount} backup codes per user`
            : ''),
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : '2FA save failed');
    } finally {
      setPendingTf(false);
    }
  }

  async function savePolicy(): Promise<void> {
    if (!projectId) return;
    setPendingPolicy(true);
    setErr(null);
    setProof(null);
    try {
      const res = await fetch(`/api/v1/auth-v2/projects/${projectId}/password-policy`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(policy),
      });
      const body = (await res.json().catch(() => ({}))) as {
        message?: string;
        proof?: PasswordPolicyState;
        passwordPolicy?: PasswordPolicyState;
        savedAt?: string;
      };
      if (!res.ok) throw new Error(body.message ?? `http ${res.status}`);
      const live = body.proof ?? body.passwordPolicy;
      if (live) setPolicy(live);
      setProof(
        `password policy saved ${body.savedAt ?? 'ok'} — min ${live?.minLength ?? '?'} chars` +
          (live?.maxAgeDays ? ` · expires every ${live.maxAgeDays} days` : ' · no expiry'),
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'policy save failed');
    } finally {
      setPendingPolicy(false);
    }
  }

  if (enabledProjects.length === 0) {
    return (
      <p className="font-mono text-xs text-[var(--color-text-muted)]">
        enable Auth on a project first (see projects).
      </p>
    );
  }

  return (
    <div className="flex max-w-xl flex-col gap-8">
      <label className="flex flex-col gap-1 font-mono text-xs">
        <span className="text-[var(--color-text-muted)]">project</span>
        <select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="rounded-md border bg-[var(--color-surface)] px-3 py-2 text-[var(--color-text)]"
          style={{ borderColor: 'var(--auth-accent-border)' }}
        >
          {enabledProjects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.slug})
            </option>
          ))}
        </select>
      </label>

      {/* 2FA + backup codes */}
      <section className="flex flex-col gap-3">
        <div>
          <h3 className="font-mono text-sm text-[var(--color-text)]">two-factor (2FA)</h3>
          <p className="mt-1 font-mono text-[10px] leading-relaxed text-[var(--color-text-muted)]">
            when on, users can enroll an authenticator app. after enroll they get{' '}
            <strong className="text-[var(--color-text)]">10 one-time backup codes</strong> for if
            they lose their phone. apps use{' '}
            <code className="text-[var(--color-text)]">auth.twoFactor.verifyBackupCode</code>.
          </p>
        </div>

        <ul className="flex flex-col gap-3">
          <ToggleRow
            label="enable 2FA"
            help="TOTP app codes + 10 backup recovery codes"
            on={twoFactor.enabled}
            onToggle={() =>
              setTwoFactor((f) => ({
                ...f,
                enabled: !f.enabled,
                required: !f.enabled ? f.required : false,
                backupCodeCount: !f.enabled ? 10 : 0,
              }))
            }
          />
          <ToggleRow
            label="require 2FA for all users"
            help="blocks sign-in until each user enrolls (only if 2FA is enabled)"
            on={twoFactor.required}
            disabled={!twoFactor.enabled}
            onToggle={() => setTwoFactor((f) => ({ ...f, required: !f.required }))}
          />
        </ul>

        <button
          type="button"
          disabled={pendingTf}
          onClick={() => void saveTwoFactor()}
          className="self-start rounded-md px-4 py-2 font-mono text-xs font-medium text-black disabled:opacity-50"
          style={{ background: '#FFFD74' }}
        >
          {pendingTf ? 'saving…' : 'save 2FA (with live proof)'}
        </button>
      </section>

      {/* Session inactivity (gap fix #1 polish in UI) */}
      <section className="flex flex-col gap-3">
        <div>
          <h3 className="font-mono text-sm text-[var(--color-text)]">session timeout</h3>
          <p className="mt-1 font-mono text-[10px] leading-relaxed text-[var(--color-text-muted)]">
            kick users after this many minutes of no activity. 0 = never. checked on every
            authenticated request.
          </p>
        </div>
        <label className="flex flex-col gap-1 font-mono text-xs">
          <span className="text-[var(--color-text-muted)]">inactivity minutes</span>
          <input
            type="number"
            min={0}
            max={1440}
            value={inactivityMinutes}
            onChange={(e) => setInactivityMinutes(Number(e.target.value) || 0)}
            className="w-28 rounded-md border bg-[var(--color-surface)] px-3 py-2"
            style={{ borderColor: 'var(--auth-accent-border)' }}
          />
        </label>
        <button
          type="button"
          disabled={pendingSession}
          onClick={() => void saveSession()}
          className="self-start rounded-md px-4 py-2 font-mono text-xs font-medium text-black disabled:opacity-50"
          style={{ background: '#FFFD74' }}
        >
          {pendingSession ? 'saving…' : 'save session timeout'}
        </button>
      </section>

      {/* password policy */}
      <section className="flex flex-col gap-3">
        <div>
          <h3 className="font-mono text-sm text-[var(--color-text)]">password rules</h3>
          <p className="mt-1 font-mono text-[10px] leading-relaxed text-[var(--color-text-muted)]">
            applied when people set or change a password. expiry forces a reset after N days.
          </p>
        </div>

        <label className="flex flex-col gap-1 font-mono text-xs">
          <span className="text-[var(--color-text-muted)]">minimum length</span>
          <input
            type="number"
            min={6}
            max={128}
            value={policy.minLength}
            onChange={(e) =>
              setPolicy((p) => ({ ...p, minLength: Number(e.target.value) || 8 }))
            }
            className="w-24 rounded-md border bg-[var(--color-surface)] px-3 py-2"
            style={{ borderColor: 'var(--auth-accent-border)' }}
          />
        </label>

        <ul className="flex flex-col gap-3">
          <ToggleRow
            label="require uppercase"
            help="at least one A–Z"
            on={policy.requireUppercase}
            onToggle={() => setPolicy((p) => ({ ...p, requireUppercase: !p.requireUppercase }))}
          />
          <ToggleRow
            label="require lowercase"
            help="at least one a–z"
            on={policy.requireLowercase}
            onToggle={() => setPolicy((p) => ({ ...p, requireLowercase: !p.requireLowercase }))}
          />
          <ToggleRow
            label="require number"
            help="at least one digit"
            on={policy.requireNumber}
            onToggle={() => setPolicy((p) => ({ ...p, requireNumber: !p.requireNumber }))}
          />
          <ToggleRow
            label="require special character"
            help="symbol such as ! @ #"
            on={policy.requireSpecial}
            onToggle={() => setPolicy((p) => ({ ...p, requireSpecial: !p.requireSpecial }))}
          />
        </ul>

        <div className="flex flex-wrap gap-4">
          <label className="flex flex-col gap-1 font-mono text-xs">
            <span className="text-[var(--color-text-muted)]">max age (days, blank = never)</span>
            <input
              type="number"
              min={1}
              max={3650}
              value={policy.maxAgeDays ?? ''}
              placeholder="never"
              onChange={(e) => {
                const v = e.target.value.trim();
                setPolicy((p) => ({
                  ...p,
                  maxAgeDays: v === '' ? null : Number(v) || null,
                }));
              }}
              className="w-28 rounded-md border bg-[var(--color-surface)] px-3 py-2"
              style={{ borderColor: 'var(--auth-accent-border)' }}
            />
          </label>
          <label className="flex flex-col gap-1 font-mono text-xs">
            <span className="text-[var(--color-text-muted)]">block last N passwords</span>
            <input
              type="number"
              min={0}
              max={24}
              value={policy.preventReuse}
              onChange={(e) =>
                setPolicy((p) => ({ ...p, preventReuse: Number(e.target.value) || 0 }))
              }
              className="w-24 rounded-md border bg-[var(--color-surface)] px-3 py-2"
              style={{ borderColor: 'var(--auth-accent-border)' }}
            />
          </label>
        </div>

        <button
          type="button"
          disabled={pendingPolicy}
          onClick={() => void savePolicy()}
          className="self-start rounded-md px-4 py-2 font-mono text-xs font-medium text-black disabled:opacity-50"
          style={{ background: '#FFFD74' }}
        >
          {pendingPolicy ? 'saving…' : 'save password rules (with live proof)'}
        </button>
      </section>

      {proof ? (
        <p className="font-mono text-xs" style={{ color: 'var(--auth-accent)' }}>
          {proof}
        </p>
      ) : null}
      {err ? <p className="font-mono text-xs text-[var(--color-error)]">{err}</p> : null}
    </div>
  );
}

function ToggleRow({
  label,
  help,
  on,
  onToggle,
  disabled,
}: {
  label: string;
  help: string;
  on: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <li
      className="flex items-start justify-between gap-4 rounded-md border p-3"
      style={{
        borderColor: 'var(--auth-accent-border)',
        background: 'var(--color-surface-raised)',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <div>
        <p className="font-mono text-sm text-[var(--color-text)]">{label}</p>
        <p className="mt-0.5 font-mono text-[10px] text-[var(--color-text-muted)]">{help}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        disabled={disabled}
        onClick={onToggle}
        className="relative h-6 w-11 shrink-0 rounded-full transition disabled:cursor-not-allowed"
        style={{ background: on ? '#FFFD74' : 'var(--color-border)' }}
      >
        <span
          className="absolute top-0.5 size-5 rounded-full bg-white transition"
          style={{ left: on ? '1.35rem' : '0.15rem' }}
        />
      </button>
    </li>
  );
}
