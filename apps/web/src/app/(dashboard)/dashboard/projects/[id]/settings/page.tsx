import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { apiFetch, apiJson } from '../../../../../../lib/api.js';
import { DeleteProjectButton } from './delete-project-button.js';

interface Project {
  id: string;
  name: string;
  slug: string;
}

export const dynamic = 'force-dynamic';

export default async function SettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { project } = await apiJson<{ project: Project }>(`/v1/projects/${id}`);

  async function update(formData: FormData) {
    'use server';
    const { id } = await params;
    const name = String(formData.get('name') ?? '').trim();
    const slug = String(formData.get('slug') ?? '').trim();
    const body: { name?: string; slug?: string } = {};
    if (name) body.name = name;
    if (slug) body.slug = slug;

    const res = await apiFetch(`/v1/projects/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(body || `update failed: ${res.status}`);
    }
    revalidatePath(`/dashboard/projects/${id}`);
  }

  async function deleteProject() {
    'use server';
    const { id } = await params;
    const res = await apiFetch(`/v1/projects/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`delete failed: ${res.status}`);
    redirect('/dashboard/projects');
  }

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="font-mono text-sm text-[var(--color-text)]">general</h2>
        <form
          action={update}
          className="mt-4 flex max-w-md flex-col gap-4 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-5"
        >
          <label className="flex flex-col gap-2">
            <span className="font-mono text-xs text-[var(--color-text-muted)]">name</span>
            <input
              name="name"
              type="text"
              defaultValue={project.name}
              maxLength={80}
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--color-primary)]"
            />
          </label>
          <label className="flex flex-col gap-2">
            <span className="font-mono text-xs text-[var(--color-text-muted)]">slug</span>
            <input
              name="slug"
              type="text"
              defaultValue={project.slug}
              pattern="[a-z0-9](?:[a-z0-9\-]{0,30}[a-z0-9])?"
              maxLength={32}
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--color-primary)]"
            />
          </label>
          <button
            type="submit"
            className="self-start rounded-md bg-[var(--color-primary)] px-4 py-2 font-mono text-sm font-medium text-[var(--color-text-inverse)]"
          >
            save
          </button>
        </form>
      </section>

      <section>
        <h2 className="font-mono text-sm text-red-400">danger zone</h2>
        <div className="mt-4 flex items-start justify-between gap-4 rounded-md border border-red-400/30 bg-red-400/5 p-5">
          <div>
            <p className="font-mono text-sm">delete this project</p>
            <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
              soft-deletes the project. the schema and data are retained for 30 days before hard
              deletion, per <code className="text-[var(--color-text)]">CLAUDE.md §5.5</code>.
            </p>
          </div>
          <DeleteProjectButton projectName={project.name} onDelete={deleteProject} />
        </div>
      </section>
    </div>
  );
}
