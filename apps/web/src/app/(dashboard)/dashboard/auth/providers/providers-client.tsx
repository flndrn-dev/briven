'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import type { AuthV2ProjectRow } from '../lib/auth-v2-types';

type ProviderRow = {
  thirdPartyId: string;
  name: string;
  configured: boolean;
  hasClientId: boolean;
  hasClientSecret: boolean;
  help?: string;
  callbackHint?: string;
};

type MethodFlags = {
  emailPassword: boolean;
  passwordlessEmail: boolean;
  magicLink: boolean;
  passwordlessSms: boolean;
  passkeys: boolean;
  mfa: boolean;
};

type ProjectConfig = {
  projectId: string;
  tenantId: string;
  providers: ProviderRow[];
  methods?: MethodFlags;
  delivery: {
    sms: { configured: boolean };
    email: { configured: boolean };
  };
};

const CORE_METHODS: Array<{
  key: keyof MethodFlags;
  label: string;
  help: string;
}> = [
  {
    key: 'emailPassword',
    label: 'email + password',
    help: 'Classic email and password sign-in.',
  },
  {
    key: 'passwordlessEmail',
    label: 'passwordless-email',
    help: 'One-time code by email (mittera / SMTP).',
  },
  {
    key: 'magicLink',
    label: 'magic-link',
    help: 'Magic link by email — same mail path as OTP.',
  },
  {
    key: 'passwordlessSms',
    label: 'passwordless-sms',
    help: 'SMS one-time code — turn on here, then set Twilio below.',
  },
  {
    key: 'passkeys',
    label: 'passkeys',
    help: 'WebAuthn passkeys — no client secret.',
  },
  {
    key: 'mfa',
    label: 'mfa (TOTP)',
    help: 'Authenticator app after password when enrolled.',
  },
];

/**
 * Providers section = manage ALL authentication ways for this project:
 * core methods (on/off) + OAuth (Konnos, Google, GitHub…) with secrets.
 */
export function AuthProvidersClient({
  projects,
  platformMethods: _platformMethods,
  lockProjectId,
}: {
  projects: AuthV2ProjectRow[];
  platformMethods: string[];
  lockProjectId?: string;
}) {
  const search = useSearchParams();
  const initialProvider = search.get('provider') ?? 'konnos';

  const [projectId, setProjectId] = useState(
    lockProjectId ?? projects[0]?.id ?? '',
  );
  const [config, setConfig] = useState<ProjectConfig | null>(null);
  const [methods, setMethods] = useState<MethodFlags | null>(null);
  /** Which OAuth setup forms are open (multi — stack all of them). */
  const [openIds, setOpenIds] = useState<string[]>([initialProvider]);
  /** Per-provider draft secrets while typing. */
  const [drafts, setDrafts] = useState<
    Record<string, { clientId: string; clientSecret: string }>
  >({});
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [methodPending, setMethodPending] = useState<string | null>(null);
  /** Twilio-compatible SMS secrets draft (never pre-filled from server). */
  const [smsDraft, setSmsDraft] = useState({
    accountSid: '',
    authToken: '',
    fromNumber: '',
  });
  const [smsPending, setSmsPending] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [testPending, setTestPending] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const focusSms =
    search.get('method') === 'passwordlessSms' ||
    search.get('method') === 'sms';

  const load = useCallback(async (id: string) => {
    if (!id) return;
    setErr(null);
    // Prefer local dashboard proxy (cookies + Origin). Fallback rewrite to
    // /api/v1/... only if proxy is missing (legacy deploys).
    const urls = [
      `/api/dashboard/auth-core/projects/${encodeURIComponent(id)}/config`,
      `/api/v1/auth-core/projects/${encodeURIComponent(id)}/config`,
    ];
    let res: Response | null = null;
    let lastStatus = 0;
    for (const url of urls) {
      try {
        res = await fetch(url, { credentials: 'include', cache: 'no-store' });
        lastStatus = res.status;
        // 404 = wrong path (rewrite ate dashboard). Try next URL.
        if (res.status === 404) continue;
        break;
      } catch {
        res = null;
      }
    }
    if (!res) {
      setErr('could not reach auth config');
      setConfig(null);
      setMethods(null);
      return;
    }
    if (res.status === 401) {
      setErr('sign in to briven.tech to manage providers');
      setConfig(null);
      setMethods(null);
      return;
    }
    if (res.status === 403) {
      setErr('you need admin access on this project');
      setConfig(null);
      setMethods(null);
      return;
    }
    if (!res.ok) {
      setErr(`load failed (${lastStatus || res.status})`);
      setConfig(null);
      setMethods(null);
      return;
    }
    const body = (await res.json()) as ProjectConfig;
    setConfig(body);
    if (body.methods) setMethods(body.methods);
    else setMethods(null);
    const ids = body.providers?.map((p) => p.thirdPartyId) ?? [];
    // Keep open forms; seed first open if empty
    setOpenIds((prev) => {
      const kept = prev.filter((x) => ids.includes(x));
      if (kept.length) return kept;
      if (initialProvider && ids.includes(initialProvider)) {
        return [initialProvider];
      }
      // Auto-open every already-configured provider so you see them all
      const configured = (body.providers ?? [])
        .filter((p) => p.configured)
        .map((p) => p.thirdPartyId);
      if (configured.length) return configured;
      return ids[0] ? [ids[0]] : [];
    });
  }, [initialProvider]);

  useEffect(() => {
    if (projectId) void load(projectId);
  }, [projectId, load]);

  const apiOrigin =
    typeof window !== 'undefined'
      ? (() => {
          const h = window.location.hostname;
          if (h === 'briven.tech' || h === 'www.briven.tech') {
            return 'https://api.briven.tech';
          }
          if (h.includes('localhost')) return 'http://localhost:3001';
          return window.location.origin;
        })()
      : 'https://api.briven.tech';

  function callbackFor(p: ProviderRow): string {
    if (p.callbackHint) {
      return p.callbackHint
        .replace('{apiOrigin}', apiOrigin)
        .replace('{projectId}', projectId)
        .replace(
          /^(Redirect URI: |Authorized redirect: |Authorization callback URL: )/i,
          '',
        );
    }
    return `${apiOrigin}/v1/auth-core/oauth/${p.thirdPartyId}/callback`;
  }

  function toggleOpen(id: string): void {
    setOpenIds((prev) => {
      if (prev.includes(id)) {
        // Keep at least one form open if possible
        if (prev.length === 1) return prev;
        return prev.filter((x) => x !== id);
      }
      return [...prev, id];
    });
    setOkMsg(null);
    setErr(null);
  }

  function setDraft(
    id: string,
    field: 'clientId' | 'clientSecret',
    value: string,
  ): void {
    setDrafts((prev) => ({
      ...prev,
      [id]: {
        clientId: prev[id]?.clientId ?? '',
        clientSecret: prev[id]?.clientSecret ?? '',
        [field]: value,
      },
    }));
  }

  async function toggleMethod(key: keyof MethodFlags): Promise<void> {
    if (!projectId || !methods) return;
    const next = !methods[key];
    setMethodPending(key);
    setErr(null);
    setOkMsg(null);
    try {
      const res = await fetch(
        `/api/dashboard/auth-core/projects/${encodeURIComponent(projectId)}/methods`,
        {
          method: 'PUT',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ [key]: next }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as {
        message?: string;
        methods?: MethodFlags;
      };
      if (!res.ok) throw new Error(body.message ?? `http ${res.status}`);
      if (body.methods) setMethods(body.methods);
      else setMethods((m) => (m ? { ...m, [key]: next } : m));
      setOkMsg(`${key} ${next ? 'on' : 'off'} for this project`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'could not update method');
    } finally {
      setMethodPending(null);
    }
  }

  async function saveSms(): Promise<void> {
    if (!projectId) return;
    const accountSid = smsDraft.accountSid.trim();
    const authToken = smsDraft.authToken.trim();
    const fromNumber = smsDraft.fromNumber.trim();
    if (!accountSid || !authToken || !fromNumber) {
      setErr(
        'Fill Account SID, Auth token, and From number (like +15551234567), then save.',
      );
      return;
    }
    if (!fromNumber.startsWith('+')) {
      setErr('From number must start with + and country code (E.164), e.g. +15551234567.');
      return;
    }
    setSmsPending(true);
    setErr(null);
    setOkMsg(null);
    try {
      const res = await fetch(
        `/api/dashboard/auth-core/projects/${encodeURIComponent(projectId)}/delivery/sms`,
        {
          method: 'PUT',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ accountSid, authToken, fromNumber }),
        },
      );
      const rawText = await res.text();
      let body: {
        ok?: boolean;
        message?: string;
        code?: string;
        config?: ProjectConfig;
      } = {};
      try {
        body = JSON.parse(rawText) as typeof body;
      } catch {
        body = { message: rawText.slice(0, 200) || res.statusText };
      }
      if (!res.ok) {
        throw new Error(
          body.message ?? body.code ?? `save failed (http ${res.status})`,
        );
      }
      setSmsDraft({ accountSid: '', authToken: '', fromNumber: '' });
      await load(projectId);
      if (body.config?.delivery?.sms) {
        setConfig((prev) =>
          prev
            ? {
                ...prev,
                delivery: {
                  ...prev.delivery,
                  sms: body.config!.delivery.sms,
                },
              }
            : prev,
        );
      } else {
        setConfig((prev) =>
          prev
            ? {
                ...prev,
                delivery: {
                  ...prev.delivery,
                  sms: { configured: true },
                },
              }
            : prev,
        );
      }
      setOkMsg(
        'SMS secrets saved for this project. Turn on passwordless-sms above if it is still off. You can send a test SMS below.',
      );
      setTestMsg(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'could not save SMS secrets');
    } finally {
      setSmsPending(false);
    }
  }

  async function sendTestSms(): Promise<void> {
    if (!projectId) return;
    const phoneNumber = testPhone.trim();
    if (!phoneNumber.startsWith('+')) {
      setTestMsg(null);
      setErr(
        'Test phone must start with + and country code (E.164), e.g. +15551234567.',
      );
      return;
    }
    setTestPending(true);
    setErr(null);
    setOkMsg(null);
    setTestMsg(null);
    try {
      const res = await fetch(
        `/api/dashboard/auth-core/projects/${encodeURIComponent(projectId)}/delivery/sms/test`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ phoneNumber }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        hint?: string;
        delivery?: { ok?: boolean; mode?: string; message?: string };
        passwordlessSmsEnabled?: boolean;
      };
      if (!res.ok || !body.ok) {
        const detail =
          body.delivery?.message ??
          body.message ??
          `test failed (http ${res.status})`;
        throw new Error(detail);
      }
      setTestMsg(
        body.hint ??
          body.delivery?.message ??
          'Test SMS sent — check your phone.',
      );
      setOkMsg('Test SMS sent. Check your phone.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'could not send test SMS');
    } finally {
      setTestPending(false);
    }
  }

  async function saveOauth(providerId: string): Promise<void> {
    const draft = drafts[providerId];
    const clientId = draft?.clientId?.trim() ?? '';
    const clientSecret = draft?.clientSecret?.trim() ?? '';
    if (!projectId) return;
    if (!clientId || !clientSecret) {
      setErr('Enter both client id and client secret, then click save.');
      return;
    }
    setPendingId(providerId);
    setErr(null);
    setOkMsg(null);
    try {
      const res = await fetch(
        `/api/dashboard/auth-core/projects/${encodeURIComponent(projectId)}/providers/${encodeURIComponent(providerId)}`,
        {
          method: 'PUT',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ clientId, clientSecret }),
        },
      );
      const rawText = await res.text();
      let body: {
        ok?: boolean;
        message?: string;
        code?: string;
        config?: ProjectConfig;
      } = {};
      try {
        body = JSON.parse(rawText) as typeof body;
      } catch {
        body = { message: rawText.slice(0, 200) || res.statusText };
      }
      if (!res.ok) {
        throw new Error(
          body.message ??
            body.code ??
            `save failed (http ${res.status})`,
        );
      }
      setDrafts((prev) => ({
        ...prev,
        [providerId]: { clientId: '', clientSecret: '' },
      }));
      setOpenIds((prev) =>
        prev.includes(providerId) ? prev : [...prev, providerId],
      );

      // Always reload from server so Security + chips match DB
      await load(projectId);

      // Ensure this provider shows as on even if cache lags
      setConfig((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          providers: prev.providers.map((p) =>
            p.thirdPartyId === providerId
              ? {
                  ...p,
                  configured: true,
                  hasClientId: true,
                  hasClientSecret: true,
                }
              : p,
          ),
        };
      });
      if (body.config?.methods) setMethods(body.config.methods);

      const name =
        body.config?.providers?.find((p) => p.thirdPartyId === providerId)
          ?.name ??
        config?.providers.find((p) => p.thirdPartyId === providerId)?.name ??
        providerId;
      setOkMsg(
        `${name} saved. Open Security — it should list this OAuth under “OAuth (secrets saved)”.`,
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'save failed');
    } finally {
      setPendingId(null);
    }
  }

  async function revokeOauth(providerId: string, providerName: string): Promise<void> {
    if (!projectId) return;
    const ok = window.confirm(
      `Revoke ${providerName} OAuth for this project?\n\n` +
        `Client ID and client secret will be deleted. The fields go empty again. ` +
        `Apps using this provider will stop signing in until you paste new secrets.`,
    );
    if (!ok) return;
    setPendingId(`revoke:${providerId}`);
    setErr(null);
    setOkMsg(null);
    try {
      const res = await fetch(
        `/api/dashboard/auth-core/projects/${encodeURIComponent(projectId)}/providers/${encodeURIComponent(providerId)}`,
        { method: 'DELETE', credentials: 'include' },
      );
      const body = (await res.json().catch(() => ({}))) as {
        message?: string;
        code?: string;
        config?: ProjectConfig;
      };
      if (!res.ok) {
        throw new Error(body.message ?? body.code ?? `http ${res.status}`);
      }
      setDrafts((prev) => ({
        ...prev,
        [providerId]: { clientId: '', clientSecret: '' },
      }));
      await load(projectId);
      setConfig((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          providers: prev.providers.map((p) =>
            p.thirdPartyId === providerId
              ? {
                  ...p,
                  configured: false,
                  hasClientId: false,
                  hasClientSecret: false,
                }
              : p,
          ),
        };
      });
      if (body.config) setConfig(body.config);
      setOkMsg(
        `${providerName} revoked — client id and secret deleted. Paste new secrets to enable again.`,
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'revoke failed');
    } finally {
      setPendingId(null);
    }
  }

  async function saveAllOpenOauth(): Promise<void> {
    const toSave = openIds.filter((id) => {
      const d = drafts[id];
      return Boolean(d?.clientId?.trim() && d?.clientSecret?.trim());
    });
    if (toSave.length === 0) {
      setErr(
        'Fill client id + secret on each OAuth form you want saved, then click save (or save open forms).',
      );
      return;
    }
    setErr(null);
    const errors: string[] = [];
    const saved: string[] = [];
    for (const id of toSave) {
      const draft = drafts[id];
      const clientId = draft?.clientId?.trim() ?? '';
      const clientSecret = draft?.clientSecret?.trim() ?? '';
      setPendingId(id);
      try {
        const res = await fetch(
          `/api/dashboard/auth-core/projects/${encodeURIComponent(projectId)}/providers/${encodeURIComponent(id)}`,
          {
            method: 'PUT',
            credentials: 'include',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ clientId, clientSecret }),
          },
        );
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
          code?: string;
        };
        if (!res.ok) {
          errors.push(
            `${id}: ${body.message ?? body.code ?? `http ${res.status}`}`,
          );
        } else {
          saved.push(id);
          setDrafts((prev) => ({
            ...prev,
            [id]: { clientId: '', clientSecret: '' },
          }));
        }
      } catch (e) {
        errors.push(
          `${id}: ${e instanceof Error ? e.message : 'failed'}`,
        );
      }
    }
    setPendingId(null);
    await load(projectId);
    if (saved.length) {
      setConfig((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          providers: prev.providers.map((p) =>
            saved.includes(p.thirdPartyId)
              ? {
                  ...p,
                  configured: true,
                  hasClientId: true,
                  hasClientSecret: true,
                }
              : p,
          ),
        };
      });
      setOkMsg(
        `Saved: ${saved.join(', ')}. Check Security → OAuth (secrets saved).`,
      );
    }
    if (errors.length) {
      setErr(errors.join(' · '));
    }
  }

  const openProviders = useMemo(() => {
    if (!config?.providers?.length) return [] as ProviderRow[];
    // Preserve open order; skip unknown ids
    const byId = new Map(config.providers.map((p) => [p.thirdPartyId, p]));
    return openIds
      .map((id) => byId.get(id))
      .filter((p): p is ProviderRow => p != null);
  }, [config, openIds]);

  if (projects.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-[var(--color-border)] p-8 font-mono text-sm text-[var(--color-text-muted)]">
        no projects yet. create a project first.
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {!lockProjectId ? (
        <label className="flex max-w-md flex-col gap-1 font-mono text-xs">
          <span className="text-[var(--color-text-muted)]">project</span>
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="rounded-md border bg-[var(--color-surface)] px-3 py-2 text-[var(--color-text)]"
            style={{ borderColor: 'var(--auth-accent-border)' }}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {/* ── Sign-in methods for this project ── */}
      <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6">
        <h2 className="font-mono text-sm text-[var(--color-text)]">
          sign-in methods
        </h2>
        <p className="mt-1 font-mono text-[11px] text-[var(--color-text-muted)]">
          turn on only what this app should use. yellow = on for this project.
        </p>

        {methods ? (
          <ul className="mt-4 space-y-2">
            {CORE_METHODS.map((m) => {
              const on = Boolean(methods[m.key]);
              const smsSecretsOk = Boolean(config?.delivery?.sms?.configured);
              const smsHint =
                m.key === 'passwordlessSms'
                  ? on && !smsSecretsOk
                    ? ' · Twilio not set yet'
                    : on && smsSecretsOk
                      ? ' · Twilio ready'
                      : !on && smsSecretsOk
                        ? ' · secrets saved, method off'
                        : ''
                  : '';
              return (
                <li
                  key={m.key}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--color-border-subtle)] px-3 py-3"
                >
                  <div className="min-w-0">
                    <p className="font-mono text-xs text-[var(--color-text)]">
                      {m.label}
                      {smsHint ? (
                        <span className="text-[var(--color-text-muted)]">
                          {smsHint}
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 font-mono text-[10px] text-[var(--color-text-muted)]">
                      {m.help}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={methodPending === m.key}
                    onClick={() => void toggleMethod(m.key)}
                    className="shrink-0 rounded-md px-3 py-1.5 font-mono text-[11px] font-medium disabled:opacity-50"
                    style={
                      on
                        ? { background: '#FFFD74', color: '#111' }
                        : {
                            border: '1px solid var(--color-border-subtle)',
                            color: 'var(--color-text-muted)',
                          }
                    }
                  >
                    {methodPending === m.key
                      ? '…'
                      : on
                        ? 'on'
                        : 'off'}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : err ? (
          <p className="mt-3 font-mono text-xs text-red-400">
            could not load methods — {err}
          </p>
        ) : (
          <p className="mt-3 font-mono text-xs text-[var(--color-text-muted)]">
            loading methods…
          </p>
        )}
      </div>

      {/* ── SMS / Twilio for this project ── */}
      <div
        id="auth-sms-setup"
        className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6"
        style={
          focusSms
            ? { borderColor: 'var(--auth-accent-border, #FFFD74)' }
            : undefined
        }
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-mono text-sm text-[var(--color-text)]">
              SMS login (Twilio)
            </h2>
            <p className="mt-1 font-mono text-[11px] text-[var(--color-text-muted)]">
              Phone codes for this project only. Secrets stay on Briven — we
              never show them again after save.
            </p>
          </div>
          <span
            className="shrink-0 rounded-md px-2.5 py-1 font-mono text-[11px] font-medium"
            style={
              config?.delivery?.sms?.configured
                ? { background: '#FFFD74', color: '#111' }
                : {
                    border: '1px solid var(--color-border-subtle)',
                    color: 'var(--color-text-muted)',
                  }
            }
          >
            {config
              ? config.delivery?.sms?.configured
                ? 'SMS ready'
                : 'SMS not set'
              : '…'}
          </span>
        </div>

        <ul className="mt-3 list-inside list-disc font-mono text-[11px] text-[var(--color-text-muted)]">
          <li>Turn on <strong className="text-[var(--color-text)]">passwordless-sms</strong> above.</li>
          <li>
            In Twilio: Account SID, Auth Token, and a From number (starts with
            +).
          </li>
          <li>
            Without secrets, codes are only logged on the server (no real text).
          </li>
        </ul>

        {methods?.passwordlessSms && !config?.delivery?.sms?.configured ? (
          <p className="mt-3 font-mono text-[11px] text-amber-600 dark:text-amber-400">
            passwordless-sms is on, but Twilio is not set yet — phone login will
            not reach a real phone until you save secrets below.
          </p>
        ) : null}

        {!methods?.passwordlessSms && config?.delivery?.sms?.configured ? (
          <p className="mt-3 font-mono text-[11px] text-[var(--color-text-muted)]">
            Twilio is saved. Turn on passwordless-sms above so apps can use SMS
            login.
          </p>
        ) : null}

        <div className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1 font-mono text-xs">
            <span className="text-[var(--color-text-muted)]">Account SID</span>
            <input
              value={smsDraft.accountSid}
              onChange={(e) =>
                setSmsDraft((d) => ({ ...d, accountSid: e.target.value }))
              }
              autoComplete="off"
              placeholder={
                config?.delivery?.sms?.configured
                  ? '•••• set — paste new to replace'
                  : 'ACxxxxxxxx…'
              }
              className="rounded-md border bg-[var(--color-bg)] px-3 py-2 text-[var(--color-text)] outline-none focus:outline-none"
              style={{
                borderColor: 'var(--auth-accent-border, #FFFD74)',
              }}
            />
          </label>
          <label className="flex flex-col gap-1 font-mono text-xs">
            <span className="text-[var(--color-text-muted)]">Auth token</span>
            <input
              type="password"
              value={smsDraft.authToken}
              onChange={(e) =>
                setSmsDraft((d) => ({ ...d, authToken: e.target.value }))
              }
              autoComplete="new-password"
              placeholder={
                config?.delivery?.sms?.configured
                  ? '•••• set — paste new to replace'
                  : 'paste Twilio auth token'
              }
              className="rounded-md border bg-[var(--color-bg)] px-3 py-2 text-[var(--color-text)] outline-none focus:outline-none"
              style={{
                borderColor: 'var(--auth-accent-border, #FFFD74)',
              }}
            />
          </label>
          <label className="flex flex-col gap-1 font-mono text-xs">
            <span className="text-[var(--color-text-muted)]">
              From number (E.164)
            </span>
            <input
              value={smsDraft.fromNumber}
              onChange={(e) =>
                setSmsDraft((d) => ({ ...d, fromNumber: e.target.value }))
              }
              autoComplete="off"
              placeholder={
                config?.delivery?.sms?.configured
                  ? '•••• set — paste new to replace'
                  : '+15551234567'
              }
              className="rounded-md border bg-[var(--color-bg)] px-3 py-2 text-[var(--color-text)] outline-none focus:outline-none"
              style={{
                borderColor: 'var(--auth-accent-border, #FFFD74)',
              }}
            />
          </label>
          <button
            type="button"
            disabled={
              smsPending ||
              !smsDraft.accountSid.trim() ||
              !smsDraft.authToken.trim() ||
              !smsDraft.fromNumber.trim()
            }
            onClick={() => void saveSms()}
            className="w-fit rounded-md px-4 py-2 font-mono text-xs font-medium text-black disabled:opacity-50"
            style={{ background: '#FFFD74' }}
          >
            {smsPending ? 'saving…' : 'save SMS secrets'}
          </button>
        </div>

        {config?.delivery?.sms?.configured ? (
          <div
            className="mt-5 space-y-3 border-t pt-4"
            style={{ borderColor: 'var(--color-border-subtle)' }}
          >
            <p className="font-mono text-xs text-[var(--color-text)]">
              send test SMS
            </p>
            <p className="font-mono text-[10px] text-[var(--color-text-muted)]">
              Uses saved Twilio secrets. Message says this is a test — not a
              login code. Real texts may cost Twilio credit.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <label className="flex min-w-[12rem] flex-1 flex-col gap-1 font-mono text-xs">
                <span className="text-[var(--color-text-muted)]">
                  your phone (E.164)
                </span>
                <input
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                  autoComplete="tel"
                  placeholder="+15551234567"
                  className="rounded-md border bg-[var(--color-bg)] px-3 py-2 text-[var(--color-text)] outline-none focus:outline-none"
                  style={{
                    borderColor: 'var(--auth-accent-border, #FFFD74)',
                  }}
                />
              </label>
              <button
                type="button"
                disabled={testPending || !testPhone.trim()}
                onClick={() => void sendTestSms()}
                className="rounded-md px-4 py-2 font-mono text-xs font-medium text-black disabled:opacity-50"
                style={{ background: '#FFFD74' }}
              >
                {testPending ? 'sending…' : 'send test SMS'}
              </button>
            </div>
            {testMsg ? (
              <p className="font-mono text-[11px] text-[var(--color-text-muted)]">
                {testMsg}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="mt-4 font-mono text-[10px] text-[var(--color-text-muted)]">
            After secrets show as <strong className="text-[var(--color-text)]">SMS ready</strong>, a
            “send test SMS” box appears here.
          </p>
        )}
      </div>

      {/* ── OAuth providers ── */}
      <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6">
        <h2 className="font-mono text-sm text-[var(--color-text)]">
          OAuth providers
        </h2>
        <p className="mt-1 font-mono text-[11px] text-[var(--color-text-muted)]">
          Click chips to open <strong className="text-[var(--color-text)]">several</strong>{' '}
          forms at once (stacked below). Yellow chip = secrets already saved.
          Click again to hide a form (not delete secrets).
        </p>

        {config ? (
          <>
            <p className="mt-3 font-mono text-[11px] text-[var(--color-text-muted)]">
              tenant {config.tenantId}
              {config.providers.some((p) => p.configured)
                ? ` · saved: ${config.providers
                    .filter((p) => p.configured)
                    .map((p) => p.name)
                    .join(', ')}`
                : ' · none saved yet'}
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <ul className="flex flex-wrap gap-2">
                {config.providers.map((p) => {
                  const isOpen = openIds.includes(p.thirdPartyId);
                  const isOn = p.configured;
                  return (
                    <li key={p.thirdPartyId}>
                      <button
                        type="button"
                        title={
                          isOpen
                            ? `Hide ${p.name} form`
                            : `Show ${p.name} client id + secret form`
                        }
                        onClick={() => toggleOpen(p.thirdPartyId)}
                        className="rounded border px-2.5 py-1.5 font-mono text-[11px] outline-none focus:outline-none"
                        style={
                          isOn
                            ? {
                                borderColor: '#FFFD74',
                                background: '#FFFD74',
                                color: '#111',
                                boxShadow: isOpen
                                  ? '0 0 0 2px #111, 0 0 0 4px #FFFD74'
                                  : undefined,
                              }
                            : {
                                borderColor: isOpen
                                  ? '#FFFD74'
                                  : 'var(--color-border-subtle)',
                                background: isOpen
                                  ? 'color-mix(in srgb, #FFFD74 14%, transparent)'
                                  : 'transparent',
                                color: 'var(--color-text-muted)',
                              }
                        }
                      >
                        {p.thirdPartyId === 'konnos' ? (
                          // eslint-disable-next-line @next/next/no-img-element -- static mark
                          <img
                            src="/konnos.svg"
                            alt=""
                            width={14}
                            height={14}
                            className="mr-1.5 inline-block h-3.5 w-3.5 align-[-2px] object-contain"
                            aria-hidden
                          />
                        ) : null}
                        {p.name}
                        {isOn ? ' · on' : ' · set up'}
                        {isOpen ? ' · open' : ''}
                      </button>
                    </li>
                  );
                })}
              </ul>
              <button
                type="button"
                onClick={() => void saveAllOpenOauth()}
                className="ml-auto rounded-md px-3 py-1.5 font-mono text-[11px] font-medium text-black"
                style={{ background: '#FFFD74' }}
              >
                save open forms
              </button>
            </div>

            {/* One credential card per open provider — stacked, never replace */}
            <div className="mt-5 space-y-4">
              {openProviders.map((p) => {
                const draft = drafts[p.thirdPartyId] ?? {
                  clientId: '',
                  clientSecret: '',
                };
                const pending =
                  pendingId === p.thirdPartyId ||
                  pendingId === `revoke:${p.thirdPartyId}`;
                return (
                  <div
                    key={p.thirdPartyId}
                    className="space-y-3 rounded-md border p-4"
                    style={{
                      borderColor: 'var(--auth-accent-border, #FFFD74)',
                    }}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-mono text-xs text-[var(--color-text)]">
                        {p.thirdPartyId === 'konnos' ? (
                          // eslint-disable-next-line @next/next/no-img-element -- static mark
                          <img
                            src="/konnos.svg"
                            alt=""
                            width={16}
                            height={16}
                            className="mr-1.5 inline-block h-4 w-4 align-[-3px] object-contain"
                            aria-hidden
                          />
                        ) : null}
                        {p.name} — client id &amp; secret
                        {p.configured ? (
                          <span className="ml-2 text-[var(--color-text-muted)]">
                            (saved)
                          </span>
                        ) : null}
                      </p>
                      <button
                        type="button"
                        onClick={() => toggleOpen(p.thirdPartyId)}
                        className="font-mono text-[10px] text-[var(--color-text-muted)] underline"
                      >
                        hide
                      </button>
                    </div>
                    {p.help ? (
                      <p className="font-mono text-[11px] text-[var(--color-text-muted)]">
                        {p.help}
                      </p>
                    ) : null}

                    <label className="flex flex-col gap-1 font-mono text-xs">
                      <span className="text-[var(--color-text-muted)]">
                        redirect / callback URL (copy into provider console —
                        must match exactly)
                      </span>
                      <code className="break-all rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg)] px-3 py-2 text-[11px] text-[var(--color-text)]">
                        {callbackFor(p)}
                      </code>
                      {p.thirdPartyId === 'konnos' ? (
                        <p className="font-mono text-[10px] text-[var(--color-text-muted)]">
                          SuperTokens-style: redirect_uri is the OAuth callback, not
                          your post-login page. mavi pay:{' '}
                          <span className="text-[var(--color-text)]">
                            https://pay.mavifinans.sh/auth/callback
                          </span>
                          . Local:{' '}
                          <span className="text-[var(--color-text)]">
                            http://localhost:3000/auth/callback
                          </span>
                          . Must match the Konnos app field character-for-character.
                        </p>
                      ) : null}
                    </label>

                    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
                      <label className="flex min-w-[10rem] flex-1 flex-col gap-1 font-mono text-xs">
                        <span className="text-[var(--color-text-muted)]">
                          client id
                        </span>
                        <input
                          value={draft.clientId}
                          onChange={(e) =>
                            setDraft(p.thirdPartyId, 'clientId', e.target.value)
                          }
                          autoComplete="off"
                          placeholder={
                            p.hasClientId
                              ? '•••• set — paste new to replace'
                              : `paste ${p.name} client id`
                          }
                          className="rounded-md border bg-[var(--color-bg)] px-3 py-2 text-[var(--color-text)] outline-none focus:outline-none"
                          style={{
                            borderColor: 'var(--auth-accent-border, #FFFD74)',
                          }}
                        />
                      </label>
                      <label className="flex min-w-[10rem] flex-1 flex-col gap-1 font-mono text-xs">
                        <span className="text-[var(--color-text-muted)]">
                          client secret
                        </span>
                        <input
                          type="password"
                          value={draft.clientSecret}
                          onChange={(e) =>
                            setDraft(
                              p.thirdPartyId,
                              'clientSecret',
                              e.target.value,
                            )
                          }
                          autoComplete="new-password"
                          placeholder={
                            p.hasClientSecret
                              ? '•••• set — paste new to replace'
                              : `paste ${p.name} client secret`
                          }
                          className="rounded-md border bg-[var(--color-bg)] px-3 py-2 text-[var(--color-text)] outline-none focus:outline-none"
                          style={{
                            borderColor: 'var(--auth-accent-border, #FFFD74)',
                          }}
                        />
                      </label>
                      <button
                        type="button"
                        disabled={
                          pending ||
                          !draft.clientId.trim() ||
                          !draft.clientSecret.trim()
                        }
                        onClick={() => void saveOauth(p.thirdPartyId)}
                        className="rounded-md px-4 py-2 font-mono text-xs font-medium text-black disabled:opacity-50"
                        style={{ background: '#FFFD74' }}
                      >
                        {pending && pendingId === p.thirdPartyId
                          ? 'saving…'
                          : `save ${p.name}`}
                      </button>
                      {p.configured || p.hasClientId || p.hasClientSecret ? (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => void revokeOauth(p.thirdPartyId, p.name)}
                          className="rounded-md border border-[var(--color-border)] px-4 py-2 font-mono text-xs text-[var(--color-text-muted)] transition hover:border-red-500/40 hover:text-red-300 disabled:opacity-50"
                        >
                          {pendingId === `revoke:${p.thirdPartyId}`
                            ? 'revoking…'
                            : `revoke ${p.name}`}
                        </button>
                      ) : null}
                    </div>
                    {p.configured ? (
                      <p className="font-mono text-[11px] text-[var(--color-text-muted)]">
                        {p.name} is configured for this project
                      </p>
                    ) : (
                      <p className="font-mono text-[11px] text-[var(--color-text-muted)]">
                        not set yet — paste secrets from the {p.name} developer
                        console
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        ) : err ? (
          <p className="mt-3 font-mono text-xs text-red-400">
            could not load OAuth list — {err}
          </p>
        ) : (
          <p className="mt-3 font-mono text-xs text-[var(--color-text-muted)]">
            loading providers…
          </p>
        )}
      </div>

      {err ? (
        <p className="font-mono text-xs text-red-400">{err}</p>
      ) : null}
      {okMsg ? (
        <p className="font-mono text-xs text-[var(--color-text-muted)]">
          {okMsg}
        </p>
      ) : null}
    </div>
  );
}
