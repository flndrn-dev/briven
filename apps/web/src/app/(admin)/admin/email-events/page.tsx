import { apiJson } from '@/lib/api';
import { toValidDate } from '@/lib/utils';

interface EmailEvent {
  id: string;
  eventType: string;
  messageId: string | null;
  recipientRedacted: string | null;
  bounceCode: string | null;
  bounceMessage: string | null;
  complaintReason: string | null;
  deliveredAt: string | null;
  createdAt: string | Date;
}

interface EmailTemplateStat {
  template: string;
  sends: number;
  delivered: number;
  bounced: number;
  complained: number;
}

interface EmailOverview {
  sender: {
    fromAddress: string;
    mitteraConfigured: boolean;
    mitteraEndpoint: string | null;
    smtpFallbackConfigured: boolean;
    activeTransport: 'mittera' | 'smtp' | 'dev-stdout';
    recentTransport: { mittera: number; smtp: number };
    providerNote: string;
  };
  templates: EmailTemplateStat[];
}

const TRANSPORT_LABEL: Record<EmailOverview['sender']['activeTransport'], string> = {
  mittera: 'mittera.eu',
  smtp: 'SMTP fallback',
  'dev-stdout': 'dev — stdout only',
};

export const dynamic = 'force-dynamic';
export const metadata = { title: 'admin · email events' };

const SEVERITY: Record<string, 'ok' | 'warn' | 'fail'> = {
  delivered: 'ok',
  opened: 'ok',
  clicked: 'ok',
  sent: 'ok',
  'magic_link.sent': 'ok',
  'invitation.sent': 'ok',
  'email_verification.sent': 'ok',
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
  const d = toValidDate(t);
  return d ? d.toISOString().replace('T', ' ').slice(0, 19) + 'Z' : '—';
}

export default async function EmailEventsAdminPage() {
  const [{ events }, overview] = await Promise.all([
    apiJson<{ events: EmailEvent[] }>('/v1/admin/email-events').catch(() => ({
      events: [] as EmailEvent[],
    })),
    apiJson<EmailOverview>('/v1/admin/email-overview').catch(() => null),
  ]);

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

      {overview ? (
        <>
          <SenderStatus sender={overview.sender} />
          <TemplateStats templates={overview.templates} />
        </>
      ) : null}

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
                      ) : e.recipientRedacted ? (
                        <span>to {e.recipientRedacted}</span>
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

/**
 * Live sender / transport status (Phase 8 §1). Shows the From: every send
 * uses + which leg Briven actually drives. Provider is deliberately absent —
 * mittera abstracts it; the note spells out why.
 */
function SenderStatus({ sender }: { sender: EmailOverview['sender'] }) {
  const transportTint =
    sender.activeTransport === 'mittera'
      ? 'bg-[var(--color-primary-subtle)] text-[var(--color-primary)]'
      : sender.activeTransport === 'smtp'
        ? 'bg-yellow-500/10 text-yellow-300'
        : 'bg-[var(--color-surface-raised)] text-[var(--color-text-muted)]';
  return (
    <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 font-mono text-xs">
      <h3 className="mb-3 text-sm text-[var(--color-text)]">active sender</h3>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
        <div className="flex flex-col gap-0.5">
          <dt className="text-[var(--color-text-muted)]">from address</dt>
          <dd className="text-[var(--color-text)]">{sender.fromAddress}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-[var(--color-text-muted)]">active transport</dt>
          <dd>
            <span className={`inline-flex rounded-md px-2 py-0.5 ${transportTint}`}>
              {TRANSPORT_LABEL[sender.activeTransport]}
            </span>
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-[var(--color-text-muted)]">mittera endpoint</dt>
          <dd className="text-[var(--color-text-muted)]">
            {sender.mitteraEndpoint ?? <span className="text-yellow-300">not configured</span>}
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-[var(--color-text-muted)]">smtp fallback</dt>
          <dd className="text-[var(--color-text-muted)]">
            {sender.smtpFallbackConfigured ? (
              'configured'
            ) : (
              <span className="text-[var(--color-text-subtle)]">off</span>
            )}
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-[var(--color-text-muted)]">recent sends by transport</dt>
          <dd className="text-[var(--color-text)]">
            mittera {sender.recentTransport.mittera} · smtp {sender.recentTransport.smtp}
          </dd>
        </div>
      </dl>
      <p className="mt-3 border-t border-[var(--color-border-subtle)] pt-2 text-[10px] leading-relaxed text-[var(--color-text-subtle)]">
        {sender.providerNote}
      </p>
    </div>
  );
}

/**
 * Per-template stats (Phase 8 §3) — sends · delivered · bounced · complained
 * grouped by email-type. Delivery outcomes are correlated to the template via
 * the messageId captured at send time; a send whose outcomes haven't arrived
 * (or arrived outside the audit window) simply shows 0 in those columns.
 */
function TemplateStats({ templates }: { templates: EmailTemplateStat[] }) {
  if (templates.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="font-mono text-sm text-[var(--color-text)]">per-template stats</h3>
      <p className="font-mono text-[10px] text-[var(--color-text-subtle)]">
        across the recent audit window. deliveries/bounces/complaints are matched to a template by
        the send-time messageId, so very recent sends may show outcomes still catching up.
      </p>
      <div className="overflow-x-auto rounded-md border border-[var(--color-border-subtle)]">
        <table className="w-full font-mono text-xs">
          <thead className="bg-[var(--color-surface)] text-left text-[var(--color-text-muted)]">
            <tr>
              <th className="px-3 py-2 font-medium">template</th>
              <th className="px-3 py-2 text-right font-medium">sends</th>
              <th className="px-3 py-2 text-right font-medium">delivered</th>
              <th className="px-3 py-2 text-right font-medium">bounced</th>
              <th className="px-3 py-2 text-right font-medium">complained</th>
            </tr>
          </thead>
          <tbody>
            {templates.map((t) => (
              <tr key={t.template} className="border-t border-[var(--color-border-subtle)]">
                <td className="px-3 py-2 text-[var(--color-text)]">{t.template}</td>
                <td className="px-3 py-2 text-right text-[var(--color-text)]">{t.sends}</td>
                <td className="px-3 py-2 text-right text-[var(--color-primary)]">{t.delivered}</td>
                <td
                  className={`px-3 py-2 text-right ${t.bounced > 0 ? 'text-red-400' : 'text-[var(--color-text-subtle)]'}`}
                >
                  {t.bounced}
                </td>
                <td
                  className={`px-3 py-2 text-right ${t.complained > 0 ? 'text-red-400' : 'text-[var(--color-text-subtle)]'}`}
                >
                  {t.complained}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
