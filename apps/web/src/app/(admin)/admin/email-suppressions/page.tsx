import { MailIcon } from '@/components/ui/mail';

import { apiJson } from '@/lib/api';
import { toValidDate } from '@/lib/utils';

import { EmptyState } from '../_components/empty-state';
import { Section } from '../_components/section';
import { RemoveSuppressionButton, SuppressionControls } from './suppression-controls';

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
  const d = toValidDate(t);
  return d ? d.toISOString().replace('T', ' ').slice(0, 19) + 'Z' : '—';
}

function publicApiOrigin(): string {
  return process.env.NEXT_PUBLIC_BRIVEN_API_ORIGIN ?? '';
}

export default async function EmailSuppressionsAdminPage() {
  const { suppressions } = await apiJson<{ suppressions: Suppression[] }>(
    '/v1/admin/email-suppressions',
  ).catch(() => ({ suppressions: [] as Suppression[] }));
  const apiOrigin = publicApiOrigin();

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[var(--color-primary)]">
            <MailIcon size={20} />
          </span>
          <h1 className="font-mono text-xl tracking-tight">email suppressions</h1>
        </div>
        <p className="max-w-prose font-mono text-sm text-[var(--color-text-muted)]">
          recipients briven won&rsquo;t send to. populated automatically by the mittera webhook
          on permanent bounces, complaints, and mittera-side suppressions. add a manual entry to
          block a sender; remove an entry to allow sending again. mutations require fresh
          step-up auth — the prompt appears inline on stale sessions.
        </p>
      </header>

      <SuppressionControls apiOrigin={apiOrigin} />

      <Section title={`suppressed · ${suppressions.length}`} icon={<MailIcon size={16} />}>
        {suppressions.length === 0 ? (
          <EmptyState
            icon={<MailIcon size={28} />}
            title="no suppressions — the list is clear"
            message="mittera will populate this list automatically when permanent bounces or complaints land at https://api.briven.tech/mittera-webhook."
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)]">
            <table className="w-full font-mono text-xs">
              <thead className="text-left text-[11px] uppercase tracking-wider text-[var(--color-text-subtle)]">
                <tr>
                  <th className="px-6 py-4 font-medium">when</th>
                  <th className="px-6 py-4 font-medium">email</th>
                  <th className="px-6 py-4 font-medium">reason</th>
                  <th className="px-6 py-4 font-medium">detail</th>
                  <th className="px-6 py-4 font-medium" />
                </tr>
              </thead>
              <tbody>
                {suppressions.map((s) => (
                  <tr key={s.id} className="border-t border-[var(--color-border-subtle)] align-top">
                    <td className="whitespace-nowrap px-6 py-4 text-[var(--color-text-subtle)]">
                      {formatTs(s.createdAt)}
                    </td>
                    <td className="px-6 py-4 text-[var(--color-text)]">{s.email}</td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 ${REASON_TINT[s.reason]}`}
                      >
                        {REASON_LABEL[s.reason]}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-[var(--color-text-muted)]">{s.detail ?? '—'}</td>
                    <td className="px-6 py-4">
                      <RemoveSuppressionButton email={s.email} apiOrigin={apiOrigin} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
