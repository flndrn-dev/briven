'use client';

import { useCallback, useEffect, useState } from 'react';

type AuditRow = {
  id: string;
  tenantId: string;
  projectId: string | null;
  userId: string | null;
  action: string;
  ipHashHint: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown>;
  occurredAt: string;
};

/** Plain-language labels for operators (not engineers). */
const ACTION_LABELS: Record<string, string> = {
  'signin.password': 'signed in with password',
  'signin.password.fail': 'password sign-in failed',
  'signup.password': 'created account with password',
  'signin.passwordless': 'signed in with one-time code',
  'signin.passwordless.code_created': 'one-time code sent',
  'signin.passwordless.fail': 'one-time code sign-in failed',
  'signin.social': 'signed in with social / OAuth',
  'signin.social.fail': 'social / OAuth sign-in failed',
  'signin.passkey': 'signed in with passkey',
  'signin.sso': 'signed in with SSO',
  'session.created': 'session started',
  'session.revoked': 'session ended / revoked',
  'mfa.totp.verified': 'authenticator code accepted',
  'mfa.totp.fail': 'authenticator code failed',
  'config.methods.updated': 'login methods changed',
  'config.sms_secrets.saved': 'SMS (Twilio) secrets saved',
  'config.oauth_secrets.saved': 'OAuth secrets saved',
  'config.branding.saved': 'branding saved',
  'm2m.client.created': 'machine client created',
  'm2m.client.revoked': 'machine client revoked',
  'm2m.token.issued': 'machine token issued',
  'm2m.token.fail': 'machine token request failed',
  'oidc.client.created': 'IdP app registered',
  'oidc.client.revoked': 'IdP app revoked',
  'oidc.consent.granted': 'user allowed an app',
  'oidc.consent.denied': 'user denied an app',
  'oidc.code.issued': 'login code issued to app',
  'oidc.token.issued': 'IdP tokens issued',
  'oidc.token.revoked': 'IdP token revoked',
};

function labelFor(action: string): string {
  return ACTION_LABELS[action] ?? action.replace(/\./g, ' · ');
}

function shortTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function metaSummary(row: AuditRow): string | null {
  const m = row.metadata ?? {};
  const parts: string[] = [];
  if (typeof m.thirdPartyId === 'string') parts.push(m.thirdPartyId);
  if (typeof m.fromNumber === 'string') parts.push(`from ${m.fromNumber}`);
  if (typeof m.email === 'string') parts.push(m.email);
  if (typeof m.reason === 'string') parts.push(m.reason);
  if (parts.length === 0) return null;
  return parts.join(' · ');
}

/**
 * Live security diary for one Auth project — sign-ins, fails, secret changes.
 * Loads from briven-engine audit API (no raw IPs).
 */
export function AuthAuditTrailClient({ projectId }: { projectId: string }) {
  const [items, setItems] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setErr(null);
    const urls = [
      `/api/dashboard/auth-core/projects/${encodeURIComponent(projectId)}/audit?limit=50`,
      `/api/v1/auth-core/projects/${encodeURIComponent(projectId)}/audit?limit=50`,
    ];
    let lastStatus = 0;
    let lastMessage = '';
    for (const url of urls) {
      try {
        const res = await fetch(url, { credentials: 'include', cache: 'no-store' });
        lastStatus = res.status;
        if (res.status === 401) {
          setErr('sign in to briven.tech to see the audit trail');
          setItems([]);
          setLoading(false);
          return;
        }
        if (!res.ok) {
          lastMessage = (await res.text().catch(() => '')) || res.statusText;
          continue;
        }
        const body = (await res.json()) as { items?: AuditRow[] };
        setItems(body.items ?? []);
        setLoading(false);
        return;
      } catch (e) {
        lastMessage = e instanceof Error ? e.message : String(e);
      }
    }
    setErr(
      lastMessage
        ? `could not load audit (${lastStatus || '?'}) — ${lastMessage.slice(0, 120)}`
        : 'could not load audit trail',
    );
    setItems([]);
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-mono text-sm text-[var(--color-text)]">
            security diary
          </h3>
          <p className="mt-1 font-mono text-[11px] leading-relaxed text-[var(--color-text-muted)]">
            recent sign-ins, failed attempts, and config changes for this project.
            we never store full IP addresses — only a short code for correlation.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="shrink-0 rounded-md border px-3 py-1.5 font-mono text-[11px] text-[var(--color-text)] disabled:opacity-50"
          style={{ borderColor: 'var(--auth-accent-border, #FFFD74)' }}
        >
          {loading ? 'loading…' : 'refresh'}
        </button>
      </div>

      {err ? (
        <p className="font-mono text-xs text-[var(--color-text-muted)]">{err}</p>
      ) : null}

      {!err && !loading && items.length === 0 ? (
        <p className="rounded border border-dashed border-[var(--color-border-subtle)] px-3 py-4 font-mono text-xs text-[var(--color-text-muted)]">
          no events yet — they appear when someone signs in, fails a login, or you
          change providers / SMS / branding.
        </p>
      ) : null}

      {items.length > 0 ? (
        <ul className="divide-y divide-[var(--color-border-subtle)] rounded-md border border-[var(--color-border-subtle)]">
          {items.map((row) => {
            const fail = row.action.includes('.fail');
            const config = row.action.startsWith('config.');
            const summary = metaSummary(row);
            return (
              <li
                key={row.id}
                className="flex flex-col gap-0.5 px-3 py-2.5 font-mono text-[11px] sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"
              >
                <div className="min-w-0">
                  <p
                    className="text-[var(--color-text)]"
                    style={
                      fail
                        ? { color: 'var(--color-error, #f87171)' }
                        : config
                          ? { color: 'var(--auth-accent, #FFFD74)' }
                          : undefined
                    }
                  >
                    {labelFor(row.action)}
                  </p>
                  <p className="mt-0.5 text-[var(--color-text-muted)]">
                    {row.userId ? (
                      <span title={row.userId}>user {row.userId.slice(0, 12)}…</span>
                    ) : (
                      <span>no user</span>
                    )}
                    {row.ipHashHint ? (
                      <span className="ml-2">· ip {row.ipHashHint}</span>
                    ) : null}
                    {summary ? <span className="ml-2">· {summary}</span> : null}
                  </p>
                </div>
                <time
                  className="shrink-0 text-[10px] text-[var(--color-text-muted)]"
                  dateTime={row.occurredAt}
                >
                  {shortTime(row.occurredAt)}
                </time>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
