import Link from 'next/link';
import { redirect } from 'next/navigation';

import { apiFetch, apiJson } from '../../../../../../lib/api';

export const metadata = {
  title: 'new project from a template',
};

interface Org {
  id: string;
  slug: string;
  name: string;
  personal: boolean;
}

// Display metadata for the starter templates. The `id`s MUST match the
// server-side template registry in apps/api (src/templates/index.ts); the
// api validates the id when apply-template is called.
const TEMPLATES = [
  { id: 'contacts-crm', icon: '👥', name: 'Contacts / CRM', blurb: 'people, companies and deals — a simple customer manager.' },
  { id: 'inventory', icon: '📦', name: 'Inventory / stock', blurb: 'products, stock levels and suppliers.' },
  { id: 'bookings', icon: '📅', name: 'Bookings / appointments', blurb: 'clients, services and appointments.' },
  { id: 'tasks', icon: '✅', name: 'Project / tasks', blurb: 'projects, tasks, status and due dates.' },
] as const;

async function createFromTemplate(formData: FormData) {
  'use server';
  const name = String(formData.get('name') ?? '').trim();
  const region = String(formData.get('region') ?? '').trim() || undefined;
  const orgId = String(formData.get('orgId') ?? '').trim() || undefined;
  const templateId = String(formData.get('templateId') ?? '').trim();

  const res = await apiFetch('/v1/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, region, orgId }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`project create failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as { project: { id: string } };

  // Seed the chosen template. Best-effort: the project already exists, so a
  // seed failure shouldn't strand the user — they just land on an empty db.
  if (templateId) {
    const seed = await apiFetch(`/v1/projects/${data.project.id}/studio/apply-template`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ templateId }),
    });
    if (!seed.ok) {
      const body = await seed.text().catch(() => '');
      console.error(`template seed failed (${seed.status}) for ${data.project.id}: ${body}`);
    }
  }

  redirect(`/dashboard/projects/${data.project.id}`);
}

export default async function NewFromTemplatePage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const { t } = await searchParams;
  const selected = TEMPLATES.some((x) => x.id === t) ? t : TEMPLATES[0].id;

  // Load the user's orgs so they can pick where the project lives (same as
  // the blank-create flow).
  const { orgs } = await apiJson<{ orgs: Org[] }>('/v1/me/orgs');
  const sorted = [...orgs.filter((o) => o.personal), ...orgs.filter((o) => !o.personal)];

  return (
    <section className="max-w-2xl">
      <p className="mb-4 font-mono text-xs text-[var(--color-text-muted)]">
        <Link href="/dashboard/projects/new" className="hover:text-[var(--color-text)]">
          ← back
        </Link>
      </p>
      <header className="mb-8">
        <h1 className="font-mono text-xl tracking-tight">new project · from a template</h1>
        <p className="mt-1 font-mono text-sm text-[var(--color-text-muted)]">
          pick what you want to track — briven builds the tables and some example rows so you
          start with a working database, not a blank screen. you can change anything afterwards.
        </p>
      </header>

      <form action={createFromTemplate} className="flex flex-col gap-6">
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 font-mono text-xs uppercase tracking-wider text-[var(--color-text-subtle)]">
            template
          </legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {TEMPLATES.map((tpl) => (
              <label
                key={tpl.id}
                className="flex cursor-pointer items-start gap-3 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 transition hover:border-[var(--color-border-strong)] has-[:checked]:border-[var(--color-primary)] has-[:checked]:bg-[var(--color-primary-subtle)]"
              >
                <input
                  type="radio"
                  name="templateId"
                  value={tpl.id}
                  defaultChecked={tpl.id === selected}
                  className="mt-1"
                />
                <span className="flex-1">
                  <span className="flex items-center gap-2 font-mono text-sm text-[var(--color-text)]">
                    <span aria-hidden>{tpl.icon}</span> {tpl.name}
                  </span>
                  <span className="mt-1 block font-mono text-xs text-[var(--color-text-muted)]">
                    {tpl.blurb}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="flex flex-col gap-2">
          <span className="font-mono text-xs text-[var(--color-text-muted)]">org</span>
          <select
            name="orgId"
            defaultValue={sorted[0]?.id}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--color-primary)]"
          >
            {sorted.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} {o.personal ? '· personal' : '· team'}
              </option>
            ))}
          </select>
        </label>

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
            create with this template
          </button>
        </div>
      </form>
    </section>
  );
}
