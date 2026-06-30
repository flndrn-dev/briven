'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { StepUpPrompt } from '../../../../../components/step-up-prompt';

export type Tier = 'free' | 'pro' | 'team';

export interface TierCap {
  maxRows: number;
  maxTables: number;
}

interface Props {
  apiOrigin: string;
  caps: Record<Tier, TierCap>;
}

const TIERS: Tier[] = ['free', 'pro', 'team'];

interface Draft {
  maxRows: string;
  maxTables: string;
}

function toDrafts(caps: Record<Tier, TierCap>): Record<Tier, Draft> {
  return {
    free: { maxRows: String(caps.free.maxRows), maxTables: String(caps.free.maxTables) },
    pro: { maxRows: String(caps.pro.maxRows), maxTables: String(caps.pro.maxTables) },
    team: { maxRows: String(caps.team.maxRows), maxTables: String(caps.team.maxTables) },
  };
}

/**
 * Tier-cap editor. One PATCH per tier against
 * /v1/admin/storage/tier-caps/:tier. Edits take effect immediately on the
 * api — no redeploy — so the only feedback the operator needs is the row
 * snapping back to the saved value after router.refresh(). Step-up gated:
 * the api answers 403 step_up_required on stale auth and we surface the
 * password prompt inline, then retry the same tier.
 */
export function TierCapsForm({ apiOrigin, caps }: Props) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Record<Tier, Draft>>(() => toDrafts(caps));
  const [busy, setBusy] = useState<Tier | null>(null);
  const [error, setError] = useState<Partial<Record<Tier, string>>>({});
  const [pending, setPending] = useState<Tier | null>(null);
  const [, startTransition] = useTransition();

  function setField(tier: Tier, field: keyof Draft, value: string) {
    setDrafts((d) => ({ ...d, [tier]: { ...d[tier], [field]: value } }));
  }

  async function save(tier: Tier) {
    const draft = drafts[tier];
    const maxRows = Number(draft.maxRows);
    const maxTables = Number(draft.maxTables);
    if (
      !Number.isInteger(maxRows) ||
      maxRows < 0 ||
      !Number.isInteger(maxTables) ||
      maxTables < 0
    ) {
      setError((e) => ({ ...e, [tier]: 'whole non-negative numbers only' }));
      return;
    }
    setBusy(tier);
    setError((e) => ({ ...e, [tier]: undefined }));
    try {
      const res = await fetch(
        `${apiOrigin}/v1/admin/storage/tier-caps/${encodeURIComponent(tier)}`,
        {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ maxRows, maxTables }),
        },
      );
      if (res.status === 403) {
        const body = (await res.json().catch(() => null)) as { code?: string } | null;
        if (body?.code === 'step_up_required') {
          setPending(tier);
          return;
        }
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(body || `save failed: ${res.status}`);
      }
      startTransition(() => router.refresh());
    } catch (err) {
      setError((e) => ({
        ...e,
        [tier]: err instanceof Error ? err.message : 'save failed',
      }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-md border border-[var(--color-border-subtle)]">
        <table className="w-full font-mono text-xs">
          <thead className="bg-[var(--color-surface)] text-left text-[var(--color-text-muted)]">
            <tr>
              <th className="px-3 py-2 font-medium">tier</th>
              <th className="px-3 py-2 font-medium">max rows</th>
              <th className="px-3 py-2 font-medium">max tables</th>
              <th className="px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {TIERS.map((tier) => (
              <tr
                key={tier}
                className="border-t border-[var(--color-border-subtle)] align-middle"
              >
                <td className="px-3 py-2 text-[var(--color-text)]">{tier}</td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={drafts[tier].maxRows}
                    onChange={(e) => setField(tier, 'maxRows', e.target.value)}
                    disabled={busy === tier}
                    className="w-32 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 font-mono text-xs text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none disabled:opacity-50"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={drafts[tier].maxTables}
                    onChange={(e) => setField(tier, 'maxTables', e.target.value)}
                    disabled={busy === tier}
                    className="w-24 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 font-mono text-xs text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none disabled:opacity-50"
                  />
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void save(tier)}
                      disabled={busy === tier}
                      className="rounded-md border border-[var(--color-primary)] bg-[var(--color-primary-subtle)] px-3 py-1 font-mono text-xs text-[var(--color-primary)] hover:bg-[var(--color-primary)]/15 disabled:opacity-50"
                    >
                      {busy === tier ? 'saving…' : 'save'}
                    </button>
                    {error[tier] ? (
                      <span className="font-mono text-[10px] text-[var(--color-error)]">
                        {error[tier]}
                      </span>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pending != null ? (
        <StepUpPrompt
          apiOrigin={apiOrigin}
          reason={`editing the ${pending} tier storage caps requires fresh step-up auth.`}
          onSuccess={async () => {
            const t = pending;
            setPending(null);
            await save(t);
          }}
          onCancel={() => setPending(null)}
        />
      ) : null}
    </div>
  );
}
