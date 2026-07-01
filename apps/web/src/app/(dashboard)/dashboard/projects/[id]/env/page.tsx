import { revalidatePath } from 'next/cache';

import { apiFetch, apiJson } from '../../../../../../lib/api';
import { AddEnvForm } from './add-env-form';
import { DeleteEnvButton } from './delete-env-button';

interface EnvVar {
  id: string;
  key: string;
  lastFour: string;
  createdAt: string;
  updatedAt: string;
}

export const dynamic = 'force-dynamic';

export default async function EnvPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { env } = await apiJson<{ env: EnvVar[] }>(`/v1/projects/${id}/env`);

  async function upsert(formData: FormData) {
    'use server';
    const { id } = await params;
    const key = String(formData.get('key') ?? '').trim();
    const value = String(formData.get('value') ?? '');
    const res = await apiFetch(`/v1/projects/${id}/env`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key, value }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(body || `upsert failed: ${res.status}`);
    }
    revalidatePath(`/dashboard/projects/${id}/env`);
  }

  async function remove(envVarId: string) {
    'use server';
    const { id } = await params;
    const res = await apiFetch(`/v1/projects/${id}/env/${envVarId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`delete failed: ${res.status}`);
    revalidatePath(`/dashboard/projects/${id}/env`);
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="font-mono text-sm text-[var(--color-text)]">env vars</h2>
        <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
          injected as <code>ctx.env</code> on every function invoke. stored AES-256-GCM encrypted at
          rest. only the last 4 chars show here.
        </p>
      </header>

      <AddEnvForm action={upsert} />

      {env.length === 0 ? (
        <p className="rounded-md border border-dashed border-[var(--color-border)] p-6 text-center font-mono text-sm text-[var(--color-text-muted)]">
          no env vars set.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {env.map((v) => (
            <li
              key={v.id}
              className="flex items-center justify-between rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-3"
            >
              <div>
                <p className="font-mono text-sm">{v.key}</p>
                <p className="mt-0.5 font-mono text-xs text-[var(--color-text-subtle)]">
                  •••{v.lastFour} · updated {new Date(v.updatedAt).toISOString().slice(0, 10)}
                </p>
              </div>
              <DeleteEnvButton envVarId={v.id} envKey={v.key} onDelete={remove} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
