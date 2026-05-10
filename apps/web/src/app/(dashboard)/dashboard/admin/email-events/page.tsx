import { apiJson } from '../../../../../lib/api';

interface EmailEvent {
  id: string;
  eventType: string;
  messageId: string | null;
  bounceCode: string | null;
  bounceMessage: string | null;
  complaintReason: string | null;
  deliveredAt: string | null;
  createdAt: string | Date;
}

export const dynamic = 'force-dynamic';
export const metadata = { title: 'admin · email events' };

const SEVERITY: Record<string, 'ok' | 'warn' | 'fail'> = {
  delivered: 'ok',
  opened: 'ok',
  clicked: 'ok',
  sent: 'ok',
  queued: 'ok',
  bounced: 'fail',
  complained: 'fail',
  rejected: 'fail',
  failed: 'fail',
  delayed: 'warn',
  deferred: 'warn',
};

function severityClass(t: string): string {
  const sev = SEVERITY[t] ?? 'warn';
  if (sev === 'ok')
    return 'inline-flex rounded-md bg-[var(--color-primary-subtle)] px-2 py-0.5 text-[var(--color-primary)]';
  if (sev === 'fail')
    return 'inline-flex rounded-md bg-red-500/10 px-2 py-0.5 text-red-400';
  return 'inline-flex rounded-md bg-yellow-500/10 px-2 py-0.5 text-yellow-300';
}

function formatTs(t: string | Date): string {
  const d = typeof t === 'string' ? new Date(t) : t;
  if (!Number.isFinite(d.getTime())) return String(t);
  return d.toISOString().replace('T', ' ').slice(0, 19) + 'Z';
}

export default async function EmailEventsAdminPage() {
  const { events } = await apiJson<{ events: EmailEvent[] }>('/v1/admin/email-events');

  // Group counts for the summary header.
  const counts = events.reduce<Record<string, number>>((acc, e) => {
    acc[e.eventType] = (acc[e.eventType] ?? 0) + 1;
    return acc;
  }, {});
  const sortedCounts = Object.entries(counts).sort((a, b) => b[1] - a[1]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="font-mono text-lg">mittera email events</h2>
        <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
          last 200 webhook events from mittera.eu, newest first. recipient addresses are
          intentionally not stored — only the messageId, which mittera correlates back. when
          investigating a delivery, check the matching messageId on mittera&apos;s side.
        </p>
      </div>

      {events.length === 0 ? (
        <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-6 font-mono text-sm text-[var(--color-text-muted)]">
          no events yet. mittera will start sending webhook events to{' '}
          <code>https://api.briven.tech/mittera-webhook</code> as soon as the first transactional
          mail goes out (magic link, invitation, verification).
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 font-mono text-xs">
            {sortedCounts.map(([type, n]) => (
              <span key={type} className={severityClass(type)}>
                {type} · {n}
              </span>
            ))}
          </div>

          <div className="overflow-x-auto rounded-md border border-[var(--color-border-subtle)]">
            <table className="w-full font-mono text-xs">
              <thead className="bg-[var(--color-surface)] text-left text-[var(--color-text-muted)]">
                <tr>
                  <th className="px-3 py-2 font-medium">when</th>
                  <th className="px-3 py-2 font-medium">event</th>
                  <th className="px-3 py-2 font-medium">messageId</th>
                  <th className="px-3 py-2 font-medium">detail</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr
                    key={e.id}
                    className="border-t border-[var(--color-border-subtle)] align-top"
                  >
                    <td className="whitespace-nowrap px-3 py-2 text-[var(--color-text-subtle)]">
                      {formatTs(e.createdAt)}
                    </td>
                    <td className="px-3 py-2">
                      <span className={severityClass(e.eventType)}>{e.eventType}</span>
                    </td>
                    <td className="px-3 py-2 text-[var(--color-text-muted)]">
                      {e.messageId ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-[var(--color-text-muted)]">
                      {e.bounceCode ? (
                        <span>
                          {e.bounceCode}
                          {e.bounceMessage ? ` · ${e.bounceMessage}` : ''}
                        </span>
                      ) : e.complaintReason ? (
                        <span>{e.complaintReason}</span>
                      ) : e.deliveredAt ? (
                        <span>delivered {formatTs(e.deliveredAt)}</span>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
