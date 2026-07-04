'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { DeleteDomainButton } from './delete-domain-button';

interface AllowedDomain {
  id: string;
  origin: string;
  isWildcard: boolean;
  createdAt: string;
}

interface Props {
  projectId: string;
  initial: AllowedDomain[];
}

interface ErrorBody {
  code?: string;
  message?: string;
}

export function DomainsForm({ projectId, initial }: Props) {
  const router = useRouter();
  const [domains, setDomains] = useState(initial);
  const [origin, setOrigin] = useState('');
  const [isWildcard, setIsWildcard] = useState(false);
  const [pending, setPending] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  async function add(): Promise<void> {
    const value = origin.trim();
    if (!value) return;
    setPending(true);
    setErrMsg(null);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/auth/allowed-domains`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ origin: value, isWildcard }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as ErrorBody;
        throw new Error(body.message ?? body.code ?? `http ${res.status}`);
      }
      const body = (await res.json()) as { domain: AllowedDomain };
      setDomains((d) =>
        [...d, body.domain].sort((a, b) => a.origin.localeCompare(b.origin)),
      );
      setOrigin('');
      setIsWildcard(false);
      router.refresh();
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'add failed');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4">
        <h3 className="font-mono text-sm text-[var(--color-text)]">add a domain</h3>
        <p className="mt-1 mb-3 font-mono text-[11px] text-[var(--color-text-muted)]">
          full address including https:// — e.g. https://yourapp.com
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="url"
            value={origin}
            onChange={(e) => setOrigin(e.target.value)}
            placeholder="https://yourapp.com"
            className="w-full max-w-md rounded-sm border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 font-mono text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
          />
          <label className="flex items-center gap-2 font-mono text-[11px] text-[var(--color-text-muted)]">
            <input
              type="checkbox"
              checked={isWildcard}
              onChange={(e) => setIsWildcard(e.target.checked)}
              className="h-4 w-4 cursor-pointer accent-[var(--color-primary)]"
            />
            include all subdomains (wildcard)
          </label>
          <button
            type="button"
            onClick={() => void add()}
            disabled={pending || !origin.trim()}
            className="rounded-md bg-[var(--color-primary)] px-4 py-2 font-mono text-xs font-medium text-[var(--color-text-inverse)] transition hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
          >
            {pending ? 'adding…' : 'add domain'}
          </button>
        </div>
        {errMsg ? (
          <p className="mt-2 font-mono text-[11px] text-[var(--color-error)]">{errMsg}</p>
        ) : null}
      </div>

      {domains.length === 0 ? (
        <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6 text-center font-mono text-xs text-[var(--color-text-muted)]">
          no domains yet — your app can&apos;t log in until you add one above.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-[var(--color-border-subtle)]">
          <table className="w-full min-w-max font-mono text-xs">
            <thead className="bg-[var(--color-surface)] text-left text-[var(--color-text-muted)]">
              <tr>
                <th className="px-3 py-2 font-normal">domain</th>
                <th className="px-3 py-2 font-normal">subdomains</th>
                <th className="px-3 py-2 font-normal"></th>
              </tr>
            </thead>
            <tbody>
              {domains.map((d) => (
                <tr key={d.id} className="border-t border-[var(--color-border-subtle)]">
                  <td className="px-3 py-2 text-[var(--color-text)]">{d.origin}</td>
                  <td className="px-3 py-2">
                    {d.isWildcard ? (
                      <span className="text-[var(--color-primary)]">included</span>
                    ) : (
                      <span className="text-[var(--color-text-subtle)]">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <DeleteDomainButton projectId={projectId} originId={d.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
