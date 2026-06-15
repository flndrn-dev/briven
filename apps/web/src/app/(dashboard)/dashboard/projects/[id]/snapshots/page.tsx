import { revalidatePath } from 'next/cache';

import { apiFetch, apiJson } from '../../../../../../lib/api';
import { ConfirmButton } from './confirm-button';
import { DiffPanel, type SnapshotDiff } from './diff-panel';
import { RestorePreview } from './restore-preview';

interface Snapshot {
  id: string;
  name: string;
  tableCount: number;
  createdAt: string;
}

interface SnapshotsResult {
  snapshots: Snapshot[];
}

export const dynamic = 'force-dynamic';

export default async function SnapshotsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const { snapshots } = await apiJson<SnapshotsResult>(`/v1/projects/${id}/studio/snapshots`);

  async function save(formData: FormData) {
    'use server';
    const { id } = await params;
    const name = String(formData.get('name') ?? '').trim() || 'snapshot';
    const res = await apiFetch(`/v1/projects/${id}/studio/snapshots`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(body || `snapshot failed: ${res.status}`);
    }
    revalidatePath(`/dashboard/projects/${id}/snapshots`);
  }

  async function restore(formData: FormData) {
    'use server';
    const { id } = await params;
    const snapId = String(formData.get('snapId') ?? '');
    const res = await apiFetch(`/v1/projects/${id}/studio/snapshots/${snapId}/restore`, {
      method: 'POST',
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(body || `restore failed: ${res.status}`);
    }
    revalidatePath(`/dashboard/projects/${id}/snapshots`);
  }

  async function compare(snapId: string): Promise<SnapshotDiff> {
    'use server';
    const { id } = await params;
    return apiJson<SnapshotDiff>(`/v1/projects/${id}/studio/snapshots/${snapId}/diff`);
  }

  async function remove(formData: FormData) {
    'use server';
    const { id } = await params;
    const snapId = String(formData.get('snapId') ?? '');
    const res = await apiFetch(`/v1/projects/${id}/studio/snapshots/${snapId}`, { method: 'DELETE' });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(body || `delete failed: ${res.status}`);
    }
    revalidatePath(`/dashboard/projects/${id}/snapshots`);
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="font-mono text-sm text-[var(--color-text)]">snapshots</h2>
        <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
          your undo button. save a snapshot of all your data before a big change — then restore it
          in one click if anything goes wrong. experiment without fear.
        </p>
      </header>

      <section className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-5">
        <form action={save} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex flex-1 flex-col gap-2">
            <span className="font-mono text-xs text-[var(--color-text-muted)]">snapshot name</span>
            <input
              name="name"
              type="text"
              maxLength={80}
              placeholder="before importing customers"
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--color-primary)]"
            />
          </label>
          <button
            type="submit"
            className="rounded-md bg-[var(--color-primary)] px-4 py-2 font-mono text-sm font-medium text-[var(--color-text-inverse)] transition hover:bg-[var(--color-primary-hover)]"
          >
            save a snapshot
          </button>
        </form>
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="font-mono text-xs uppercase tracking-wider text-[var(--color-text-subtle)]">
          your snapshots ({snapshots.length})
        </h3>
        {snapshots.length === 0 ? (
          <p className="rounded-md border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6 text-center font-mono text-sm text-[var(--color-text-muted)]">
            no snapshots yet — save one before your next big change.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {snapshots.map((s) => (
              <li
                key={s.id}
                className="flex flex-col gap-3 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-3"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-sm text-[var(--color-text)]">{s.name}</p>
                    <p className="mt-0.5 font-mono text-xs text-[var(--color-text-muted)]">
                      {s.tableCount} {s.tableCount === 1 ? 'table' : 'tables'} ·{' '}
                      {new Date(s.createdAt).toISOString().slice(0, 16).replace('T', ' ')} utc
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <form action={remove}>
                      <input type="hidden" name="snapId" value={s.id} />
                      <ConfirmButton
                        message="Delete this snapshot permanently?"
                        className="rounded-md border border-[var(--color-border-subtle)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] hover:border-[var(--color-error)] hover:text-[var(--color-error)]"
                      >
                        delete
                      </ConfirmButton>
                    </form>
                  </div>
                </div>
                {/* Restore-preview: shows what restoring WILL do (in plain words)
                    before the final confirm actually runs the restore action. */}
                <form action={restore}>
                  <input type="hidden" name="snapId" value={s.id} />
                  <RestorePreview snapshotName={s.name} loadDiff={compare.bind(null, s.id)} />
                </form>
                <DiffPanel snapshotName={s.name} loadDiff={compare.bind(null, s.id)} />
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1 font-mono text-[11px] text-[var(--color-text-subtle)]">
          click restore to preview exactly what will change before anything is overwritten. tip:
          save a fresh snapshot first if you&apos;re unsure.
        </p>
      </section>
    </div>
  );
}
