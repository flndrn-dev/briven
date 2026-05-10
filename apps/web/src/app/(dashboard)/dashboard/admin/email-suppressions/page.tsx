import { revalidatePath } from 'next/cache';

import { apiFetch, apiJson } from '../../../../../lib/api';

interface Suppression {
  id: string;
  email: string;
  reason: 'permanent_bounce' | 'complaint' | 'mittera_suppressed' | 'manual';
  detail: string | null;
  sourceEventId: string | null;
  createdAt: string | Date;
}

export const dynamic = 'force-dynamic';
export const metadata = { title: 'admin · email suppressions' };

const REASON_LABEL: Record<Suppression['reason'], string> = {
  permanent_bounce: 'permanent bounce',
  complaint: 'complaint',
  mittera_suppressed: 'mittera-suppressed',
  manual: 'manual',
};

const REASON_TINT: Record<Suppression['reason'], string> = {
  permanent_bounce: 'bg-red-500/10 text-red-400',
  complaint: 'bg-red-500/10 text-red-400',
  mittera_suppressed: 'bg-yellow-500/10 text-yellow-300',
  manual: 'bg-[var(--color-surface-raised)] text-[var(--color-text-muted)]',
};

function formatTs(t: string | Date): string {
  const d = typeof t === 'string' ? new Date(t) : t;
  if (!Number.isFinite(d.getTime())) return String(t);
  return d.toISOString().replace('T', ' ').slice(0, 19) + 'Z';
}

async function unsuppressAction(formData: FormData): Promise<void> {
  'use server';
  const email = formData.get('email');
  if (typeof email !== 'string' || !email) return;
  await apiFetch(`/v1/admin/email-suppressions/${encodeURIComponent(email)}`, { method: 'DELETE' });
  revalidatePath('/dashboard/admin/email-suppressions');
}

async function suppressAction(formData: FormData): Promise<void> {
  'use server';
  const email = formData.get('email');
  if (typeof email !== 'string' || !email) return;
  await apiFetch('/v1/admin/email-suppressions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, reason: 'manual' }),
  });
  revalidatePath('/dashboard/admin/email-suppressions');
}

export default async function EmailSuppressionsAdminPage() {
  const { suppressions } = await apiJson<{ suppressions: Suppression[] }>(
    '/v1/admin/email-suppressions',
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="font-mono text-lg">email suppressions</h2>
        <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
          recipients briven won&rsquo;t send to. populated automatically by the mittera webhook
          on permanent bounces, complaints, and mittera-side suppressions. add a manual entry to
          block a sender; remove an entry to allow sending again.
        </p>
      </div>

      <form
        action={suppressAction}
        className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3 font-mono text-xs"
      >
        <span className="text-[var(--color-text-muted)]">add manual:</span>
        <input
          type="email"
          name="email"
          required
          placeholder="user@example.com"
          className="flex-1 rounded-sm border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-2 py-1 outline-none focus:border-[var(--color-primary)]"
        />
        <button
          type="submit"
          className="rounded-md bg-[var(--color-primary)] px-3 py-1 font-medium text-[var(--color-text-inverse)] hover:bg-[var(--color-primary-hover)]"
        >
          suppress
        </button>
      </form>

      {suppressions.length === 0 ? (
        <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-6 font-mono text-sm text-[var(--color-text-muted)]">
          no suppressions. mittera will populate this list automatically when permanent bounces
          or complaints land at <code>https://api.briven.tech/mittera-webhook</code>.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-[var(--color-border-subtle)]">
          <table className="w-full font-mono text-xs">
            <thead className="bg-[var(--color-surface)] text-left text-[var(--color-text-muted)]">
              <tr>
                <th className="px-3 py-2 font-medium">when</th>
                <th className="px-3 py-2 font-medium">email</th>
                <th className="px-3 py-2 font-medium">reason</th>
                <th className="px-3 py-2 font-medium">detail</th>
                <th className="px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {suppressions.map((s) => (
                <tr key={s.id} className="border-t border-[var(--color-border-subtle)] align-top">
                  <td className="whitespace-nowrap px-3 py-2 text-[var(--color-text-subtle)]">
                    {formatTs(s.createdAt)}
                  </td>
                  <td className="px-3 py-2 text-[var(--color-text)]">{s.email}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex rounded-md px-2 py-0.5 ${REASON_TINT[s.reason]}`}>
                      {REASON_LABEL[s.reason]}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-[var(--color-text-muted)]">{s.detail ?? '—'}</td>
                  <td className="px-3 py-2">
                    <form action={unsuppressAction}>
                      <input type="hidden" name="email" value={s.email} />
                      <button
                        type="submit"
                        className="rounded-md border border-[var(--color-border)] px-2 py-1 text-[var(--color-text-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)]"
                      >
                        remove
                      </button>
                    </form>
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
