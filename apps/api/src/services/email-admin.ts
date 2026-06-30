import { getEmailSenderInfo, type EmailSenderInfo } from '../lib/email.js';
import { listAuditByActionPrefix } from './audit.js';

/**
 * Email Admin cockpit aggregation (Phase 8 §1 + §3).
 *
 * Everything here is derived from the audit-log rows the send path and the
 * mittera webhook already write — no new table. Two surfaces:
 *
 *  1. Sender / transport status — the live From: + which leg Briven drives
 *     (mittera vs SMTP fallback) + how recent sends actually split across
 *     them. See lib/email.ts:getEmailSenderInfo for the truthfully-knowable
 *     fields and why provider is intentionally absent.
 *
 *  2. Per-template stats — sends · deliveries · bounces · complaints grouped
 *     by template/email-type. Sends are tagged with their template directly
 *     in the action (`mittera.<label>.sent` / `smtp.<label>.sent`); delivery
 *     outcomes (`mittera.email.delivered|bounced|complained`) carry only the
 *     opaque messageId, so we correlate them back to a template via the
 *     messageId captured at send time.
 */

/** A minimal audit-row shape — just what the aggregation reads. */
interface StatRow {
  action: string;
  metadata: Record<string, unknown> | null;
}

/** Send rows look like `mittera.magic_link.sent` or `smtp.invitation.sent`. */
const SEND_ACTION_RE = /^(?:mittera|smtp)\.(.+)\.sent$/;
/** A `.sent` suffix marks an outbound send (vs an inbound webhook outcome). */
const SENT_SUFFIX_RE = /\.sent$/;

export interface EmailTemplateStat {
  template: string;
  sends: number;
  delivered: number;
  bounced: number;
  complained: number;
}

function readMessageId(metadata: Record<string, unknown> | null): string | null {
  return metadata && typeof metadata.messageId === 'string' ? metadata.messageId : null;
}

/**
 * Pure join — kept free of any DB call so it's unit-testable in isolation
 * (mirrors suppressions.test.ts: pin the decision logic in CI, leave the
 * DB-touching wrapper to the integration smoke).
 *
 * @param sendRows   outbound `*.sent` rows (mittera + smtp), each carrying a template + messageId
 * @param outcomeRows mittera webhook rows (delivered / bounced / complained), each carrying a messageId
 */
export function aggregateTemplateStats(
  sendRows: StatRow[],
  outcomeRows: StatRow[],
): EmailTemplateStat[] {
  const messageTemplate = new Map<string, string>();
  const stats = new Map<string, EmailTemplateStat>();

  const ensure = (template: string): EmailTemplateStat => {
    let s = stats.get(template);
    if (!s) {
      s = { template, sends: 0, delivered: 0, bounced: 0, complained: 0 };
      stats.set(template, s);
    }
    return s;
  };

  for (const r of sendRows) {
    const m = SEND_ACTION_RE.exec(r.action);
    if (!m) continue;
    const template = m[1]!;
    ensure(template).sends += 1;
    const mid = readMessageId(r.metadata);
    if (mid) messageTemplate.set(mid, template);
  }

  for (const r of outcomeRows) {
    // Strip whichever prefix fired (old `mittera.email.*`, new `mittera.*`).
    const type = r.action.replace(/^mittera\.(email\.)?/, '');
    if (type !== 'delivered' && type !== 'bounced' && type !== 'complained') continue;
    const mid = readMessageId(r.metadata);
    if (!mid) continue;
    const template = messageTemplate.get(mid);
    // Outcome whose send is outside our window — can't attribute it, skip.
    if (!template) continue;
    const s = ensure(template);
    if (type === 'delivered') s.delivered += 1;
    else if (type === 'bounced') s.bounced += 1;
    else s.complained += 1;
  }

  return [...stats.values()].sort((a, b) => b.sends - a.sends);
}

export interface EmailSenderStatus extends EmailSenderInfo {
  /** How the most recent sends actually split across the two transports. */
  recentTransport: { mittera: number; smtp: number };
  /** Why no provider field — surfaced verbatim in the cockpit. */
  providerNote: string;
}

export interface EmailAdminSummary {
  sender: EmailSenderStatus;
  templates: EmailTemplateStat[];
}

const PROVIDER_NOTE =
  'Briven sends through mittera.eu, which abstracts the underlying provider ' +
  '(SES / Mailgun / Pando). That provider is not reported back to Briven, so ' +
  'it is not shown here — check the mittera dashboard for the live provider. ' +
  '"active transport" below is the leg Briven itself drives.';

/**
 * One round-trip for the whole Email Admin cockpit: fetches the recent
 * mittera + smtp audit rows once and derives both the sender/transport
 * status and the per-template stats from them. Read-only.
 */
export async function getEmailAdminSummary(limit = 1000): Promise<EmailAdminSummary> {
  const [mitteraRows, smtpRows] = await Promise.all([
    listAuditByActionPrefix('mittera.', limit),
    listAuditByActionPrefix('smtp.', limit),
  ]);

  const sender: EmailSenderStatus = {
    ...getEmailSenderInfo(),
    recentTransport: {
      mittera: mitteraRows.filter((r) => SENT_SUFFIX_RE.test(r.action)).length,
      smtp: smtpRows.filter((r) => SENT_SUFFIX_RE.test(r.action)).length,
    },
    providerNote: PROVIDER_NOTE,
  };

  const templates = aggregateTemplateStats([...mitteraRows, ...smtpRows], mitteraRows);

  return { sender, templates };
}
