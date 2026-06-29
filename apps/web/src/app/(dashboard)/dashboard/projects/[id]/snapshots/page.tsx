import { revalidatePath } from 'next/cache';

import { apiFetch, apiJson } from '../../../../../../lib/api';
import { toValidDate } from '@/lib/utils';
import { ConfirmButton } from './confirm-button';
import { DiffPanel, type SnapshotDiff } from './diff-panel';
import { RestorePreview } from './restore-preview';

interface Snapshot {
  id: string;
  name: string;
  tableCount: number;
  createdAt: string;
  auto: boolean;
}

interface SnapshotsResult {
  snapshots: Snapshot[];
}

type AutoFrequency = 'daily' | 'twice_daily';

interface AutoSnapshotSettings {
  enabled: boolean;
  frequency: AutoFrequency;
  retentionCount: number;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastRunStatus: 'ok' | 'error' | 'skipped' | null;
  lastRunError: string | null;
}

export const dynamic = 'force-dynamic';

export default async function SnapshotsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [{ snapshots }, auto] = await Promise.all([
    apiJson<SnapshotsResult>(`/v1/projects/${id}/studio/snapshots`).catch(() => ({
      snapshots: [] as Snapshot[],
    })),
    apiJson<AutoSnapshotSettings>(`/v1/projects/${id}/studio/auto-snapshots`).catch(() => ({
      enabled: false,
      frequency: 'daily' as AutoFrequency,
      retentionCount: 7,
      nextRunAt: null,
      lastRunAt: null,
      lastRunStatus: null,
      lastRunError: null,
    })),
  ]);

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

  async function saveAuto(formData: FormData) {
    'use server';
    const { id } = await params;
    // The toggle is a checkbox: present in the form data only when on.
    const enabled = formData.get('enabled') === 'on';
    const frequency = String(formData.get('frequency') ?? 'daily');
    const retentionCount = Number(formData.get('retentionCount') ?? 7);
    const res = await apiFetch(`/v1/projects/${id}/studio/auto-snapshots`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled, frequency, retentionCount }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(body || `saving automatic backups failed: ${res.status}`);
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

      {/* Automatic backups — set-and-forget save-points on a schedule. Plain
          language: a person picks "once a day / twice a day" and "how many to
          keep"; the worker does the rest. */}
      <section className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-5">
        <div className="mb-3">
          <h3 className="font-mono text-sm text-[var(--color-text)]">automatic backups</h3>
          <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
            let briven save a snapshot for you on a schedule, so you always have a recent
            save-point — even if you forget. we keep the most recent ones and tidy up older
            automatic snapshots for you. your hand-saved snapshots are never touched.
          </p>
        </div>

        <form action={saveAuto} className="flex flex-col gap-4">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              name="enabled"
              defaultChecked={auto.enabled}
              className="h-4 w-4 accent-[var(--color-primary)]"
            />
            <span className="font-mono text-sm text-[var(--color-text)]">
              turn automatic backups on
            </span>
          </label>

          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <label className="flex flex-col gap-2">
              <span className="font-mono text-xs text-[var(--color-text-muted)]">how often</span>
              <select
                name="frequency"
                defaultValue={auto.frequency}
                className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--color-primary)]"
              >
                <option value="daily">once a day</option>
                <option value="twice_daily">twice a day</option>
              </select>
            </label>

            <label className="flex flex-col gap-2">
              <span className="font-mono text-xs text-[var(--color-text-muted)]">
                how many to keep
              </span>
              <input
                name="retentionCount"
                type="number"
                min={1}
                max={90}
                defaultValue={auto.retentionCount}
                className="w-28 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--color-primary)]"
              />
            </label>

            <button
              type="submit"
              className="rounded-md bg-[var(--color-primary)] px-4 py-2 font-mono text-sm font-medium text-[var(--color-text-inverse)] transition hover:bg-[var(--color-primary-hover)]"
            >
              save settings
            </button>
          </div>

          <p className="font-mono text-[11px] text-[var(--color-text-subtle)]">
            {auto.enabled && auto.nextRunAt
              ? `next automatic backup around ${
                  toValidDate(auto.nextRunAt)?.toISOString().slice(0, 16).replace('T', ' ') ?? '—'
                } utc.`
              : 'automatic backups are off — flip the switch above to turn them on.'}
            {auto.lastRunAt
              ? ` last automatic backup: ${
                  toValidDate(auto.lastRunAt)?.toISOString().slice(0, 16).replace('T', ' ') ?? '—'
                } utc${auto.lastRunStatus === 'error' ? ' (failed — we will retry)' : ''}.`
              : ''}
          </p>
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
                    <p className="flex items-center gap-2 truncate font-mono text-sm text-[var(--color-text)]">
                      <span className="truncate">{s.name}</span>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${
                          s.auto
                            ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]'
                            : 'bg-[var(--color-border-subtle)] text-[var(--color-text-subtle)]'
                        }`}
                      >
                        {s.auto ? 'automatic' : 'manual'}
                      </span>
                    </p>
                    <p className="mt-0.5 font-mono text-xs text-[var(--color-text-muted)]">
                      {s.tableCount} {s.tableCount === 1 ? 'table' : 'tables'} ·{' '}
                      {toValidDate(s.createdAt)
                        ? `${toValidDate(s.createdAt)!.toISOString().slice(0, 16).replace('T', ' ')} utc`
                        : '—'}
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
