import { redirect } from 'next/navigation';

import { apiFetch } from '../../../../../lib/api';

export const metadata = {
  title: 'new project',
};

async function createProject(formData: FormData) {
  'use server';
  const name = String(formData.get('name') ?? '').trim();
  const slug = String(formData.get('slug') ?? '').trim() || undefined;
  const region = String(formData.get('region') ?? '').trim() || undefined;

  const res = await apiFetch('/v1/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, slug, region }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`project create failed (${res.status}): ${body}`);
  }

  const data = (await res.json()) as { project: { id: string } };
  redirect(`/dashboard/projects/${data.project.id}`);
}

export default function NewProjectPage() {
  return (
    <section className="max-w-lg">
      <header className="mb-8">
        <h1 className="font-mono text-xl tracking-tight">new project</h1>
        <p className="mt-1 font-mono text-sm text-[var(--color-text-muted)]">
          one project = one postgres schema + one function runtime.
        </p>
      </header>

      <form action={createProject} className="flex flex-col gap-5">
        <label className="flex flex-col gap-2">
          <span className="font-mono text-xs text-[var(--color-text-muted)]">name</span>
          <input
            name="name"
            type="text"
            required
            maxLength={80}
            placeholder="my app"
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--color-primary)]"
          />
        </label>

        <label className="flex flex-col gap-2">
          <span className="font-mono text-xs text-[var(--color-text-muted)]">
            slug <span className="text-[var(--color-text-subtle)]">(optional — generated if blank)</span>
          </span>
          <input
            name="slug"
            type="text"
            pattern="[a-z0-9](?:[a-z0-9\-]{0,30}[a-z0-9])?"
            maxLength={32}
            placeholder="my-app"
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--color-primary)]"
          />
        </label>

        <label className="flex flex-col gap-2">
          <span className="font-mono text-xs text-[var(--color-text-muted)]">region</span>
          <select
            name="region"
            defaultValue="eu-west-1"
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--color-primary)]"
          >
            <option value="eu-west-1">eu-west-1 · frankfurt</option>
            <option value="us-east-1">us-east-1 · virginia</option>
          </select>
        </label>

        <div className="flex gap-3">
          <button
            type="submit"
            className="rounded-md bg-[var(--color-primary)] px-4 py-2 font-mono text-sm font-medium text-[var(--color-text-inverse)] transition hover:bg-[var(--color-primary-hover)]"
          >
            create
          </button>
        </div>
      </form>
    </section>
  );
}
