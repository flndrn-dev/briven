'use client';

import { useState, type FormEvent } from 'react';

interface Props {
  email: string;
}

interface Preview {
  projects: { id: string; name: string; slug: string }[];
  orgs: { id: string; name: string }[];
  apiKeysToRevoke: number;
}

/**
 * ACCOUNT deletion form — this is the whole-account nuke, NOT a per-project
 * delete. Before any confirmation it fetches /v1/me/delete-account/preview
 * and shows the exact blast radius (every project + workspace by name) — the
 * warning whose absence caused the account-deletion incident. Gated by BOTH
 * a typed-email match AND typing the word DELETE. To remove a single project
 * the user goes to that project's own settings → danger zone instead.
 */
export function DeleteAccountForm({ email }: Props) {
  const [confirmation, setConfirmation] = useState('');
  const [ack, setAck] = useState('');
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  async function loadPreview() {
    if (preview || loadingPreview) return;
    setLoadingPreview(true);
    try {
      const res = await fetch('/api/v1/me/delete-account/preview', { credentials: 'include' });
      if (res.ok) setPreview((await res.json()) as Preview);
    } catch {
      // Best-effort — the strong warning copy still applies without the live list.
    } finally {
      setLoadingPreview(false);
    }
  }

  const emailMatches = confirmation.trim().toLowerCase() === email.toLowerCase();
  const ackMatches = ack.trim().toUpperCase() === 'DELETE';
  const projectCount = preview?.projects.length ?? 0;
  const workspaceCount = preview?.orgs.length ?? 0;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!emailMatches || !ackMatches) return;
    setError(null);
    setPending(true);
    try {
      const res = await fetch('/api/v1/me/delete-account', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          confirmation: confirmation.trim(),
          reason: reason.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
          code?: string;
        };
        throw new Error(body.message ?? body.code ?? `delete failed: ${res.status}`);
      }
      // Session is gone server-side; bounce to the post-deletion banner.
      window.location.href = '/signin?deleted=1';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'delete failed');
    } finally {
      setPending(false);
    }
  }

  return (
    <details
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open) void loadPreview();
      }}
      className="mt-3 rounded-md border border-red-400/30 bg-red-400/5 p-5 font-mono text-sm"
    >
      <summary className="cursor-pointer text-red-400">delete account</summary>

      {/* Loud blast-radius banner — the warning that was missing during the incident. */}
      <div className="mt-3 rounded-md border border-red-500/50 bg-red-500/10 p-4">
        <p className="font-semibold text-red-400">
          This deletes your ENTIRE account — not a single project.
        </p>
        {loadingPreview ? (
          <p className="mt-2 text-xs text-[var(--color-text-muted)]">
            checking exactly what would be deleted…
          </p>
        ) : preview ? (
          <>
            <p className="mt-2 text-xs text-[var(--color-text-muted)]">
              this permanently soft-deletes {projectCount} project
              {projectCount === 1 ? '' : 's'} and {workspaceCount} workspace
              {workspaceCount === 1 ? '' : 's'}:
            </p>
            {projectCount > 0 ? (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {preview.projects.map((p) => (
                  <li
                    key={p.id}
                    className="rounded border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-xs text-red-300"
                  >
                    {p.name}
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="mt-2 text-[11px] text-[var(--color-text-subtle)]">
              to delete just ONE project, open that project → settings → danger zone instead.
            </p>
          </>
        ) : (
          <p className="mt-2 text-xs text-[var(--color-text-muted)]">
            this removes every project and workspace you solely own. to delete just one project,
            use that project&apos;s own settings → danger zone.
          </p>
        )}
      </div>

      <p className="mt-3 text-[var(--color-text-muted)]">
        soft-deletes your account immediately. you have <strong>30 days</strong> to revert
        via support before the data is hard-deleted. paid subscriptions are not
        auto-cancelled — manage cancellation on polar separately.
      </p>
      <ul className="mt-3 list-disc pl-5 text-xs text-[var(--color-text-subtle)]">
        <li>personal data on your account (legal name, address, vat, display name, image) is cleared.</li>
        <li>workspaces you solely own — and every project under them — are soft-deleted.</li>
        <li>team workspaces where you&apos;re not the only owner stay live; you&apos;re removed from membership.</li>
        <li>
          api keys you own are revoked{preview ? ` (${preview.apiKeysToRevoke})` : ''}.
        </li>
      </ul>
      <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-[var(--color-text-muted)]">
            type <code className="text-[var(--color-text)]">{email}</code> to confirm
          </span>
          <input
            type="email"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            placeholder={email}
            autoComplete="off"
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm outline-none focus:border-red-400"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-[var(--color-text-muted)]">
            then type <code className="text-red-400">DELETE</code> to acknowledge this destroys
            everything listed above
          </span>
          <input
            type="text"
            value={ack}
            onChange={(e) => setAck(e.target.value)}
            placeholder="DELETE"
            autoComplete="off"
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm outline-none focus:border-red-400"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-[var(--color-text-muted)]">
            why are you leaving? (optional — surfaced only in audit log)
          </span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="anything we can fix?"
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm outline-none focus:border-red-400"
          />
        </label>
        {error ? (
          <p className="rounded-md bg-red-400/10 px-3 py-2 text-xs text-red-400">{error}</p>
        ) : null}
        <button
          type="submit"
          disabled={pending || !emailMatches || !ackMatches}
          className="self-start rounded-md border border-red-500/40 px-4 py-2 text-sm text-red-400 transition hover:bg-red-500/10 disabled:opacity-30"
        >
          {pending ? 'deleting…' : 'permanently delete my account'}
        </button>
      </form>
    </details>
  );
}
