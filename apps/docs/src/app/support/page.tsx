import Link from 'next/link';

import { DocsShell } from '../../components/shell';

export const metadata = { title: 'support' };

export default function SupportPage() {
  return (
    <DocsShell>
      <h1 className="font-mono text-2xl tracking-tight">support</h1>
      <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
        how to get help, what response time to expect on each tier, and how to report
        problems without leaking secrets.
      </p>

      <section className="mt-8">
        <h2 className="font-mono text-lg tracking-tight">where to ask</h2>
        <ul className="mt-3 flex flex-col gap-2 font-mono text-sm">
          <li>
            <strong>community discord</strong> — open to everyone. fastest path for &quot;how
            do i…&quot; questions; expect informal answers from the team + community within
            an hour or two on Flanders business hours. (invite link lands with the public
            beta in oct 2026.)
          </li>
          <li>
            <strong>github issues</strong>{' '}
            <Link
              href="https://code.konnos.org/flndrn/briven/issues"
              className="text-[var(--color-text-link)] underline-offset-2 hover:underline"
            >
              code.konnos.org/flndrn/briven
            </Link>{' '}
            — bug reports + reproducible defects. include the build sha from the dashboard
            footer and the relevant audit-log entries (sanitised — see below).
          </li>
          <li>
            <strong>email</strong>{' '}
            <a
              href="mailto:support@briven.tech"
              className="text-[var(--color-text-link)] underline-offset-2 hover:underline"
            >
              support@briven.tech
            </a>{' '}
            — for paid customers; include your project id and the rough time of the issue.
            response targets per tier are on the SLA card in your billing dashboard.
          </li>
          <li>
            <strong>status page</strong>{' '}
            <Link
              href="/status"
              className="text-[var(--color-text-link)] underline-offset-2 hover:underline"
            >
              docs.briven.tech/status
            </Link>{' '}
            — check here first if invocations are failing platform-wide.
          </li>
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="font-mono text-lg tracking-tight">what to include in a bug report</h2>
        <ol className="mt-3 flex list-decimal flex-col gap-2 pl-5 font-mono text-sm">
          <li>
            <strong>build sha</strong> — bottom-right of the dashboard footer. pins which
            release you&apos;re on so we can correlate with deploy_history.
          </li>
          <li>
            <strong>project id</strong> (<code>p_…</code>) and approximate time of the
            failure (UTC).
          </li>
          <li>
            <strong>what you did</strong> — exact steps. for invocations, the function name
            and a sanitised version of the args.
          </li>
          <li>
            <strong>what you expected</strong> vs <strong>what you saw</strong> — paste any
            error text verbatim. error codes (the <code>code</code> field) are stable; the
            message text drifts.
          </li>
        </ol>
      </section>

      <section className="mt-8">
        <h2 className="font-mono text-lg tracking-tight">don&apos;t paste</h2>
        <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 font-mono text-sm">
          <li>
            <strong>api keys</strong> (<code>brk_…</code>). if you suspect one leaked,
            revoke it in the dashboard immediately; we&apos;ll never ask for a plaintext key
            over support.
          </li>
          <li>
            <strong>polar customer ids / payment-method ids</strong> — share the project id
            instead.
          </li>
          <li>
            <strong>real personal data from your own customers</strong> when you can avoid
            it. for repro, fabricate a single row that triggers the issue.
          </li>
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="font-mono text-lg tracking-tight">security disclosures</h2>
        <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
          report security issues to{' '}
          <a
            href="mailto:security@briven.tech"
            className="text-[var(--color-text-link)] underline-offset-2 hover:underline"
          >
            security@briven.tech
          </a>{' '}
          — encrypted reports welcome (PGP key on{' '}
          <Link
            href="/trust"
            className="text-[var(--color-text-link)] underline-offset-2 hover:underline"
          >
            /trust
          </Link>
          ). target acknowledgement is within one business day; we will not pursue legal
          action against good-faith research that follows the standard disclosure flow.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="font-mono text-lg tracking-tight">response targets by tier</h2>
        <dl className="mt-3 grid grid-cols-[120px_1fr] gap-y-2 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 font-mono text-sm">
          <dt className="text-[var(--color-text-subtle)]">free</dt>
          <dd className="text-[var(--color-text-muted)]">
            community-only; best-effort within ~48h via discord / github
          </dd>
          <dt className="text-[var(--color-text-subtle)]">pro</dt>
          <dd className="text-[var(--color-text-muted)]">email support, 48h target</dd>
          <dt className="text-[var(--color-text-subtle)]">team</dt>
          <dd className="text-[var(--color-text-muted)]">
            priority email + 99.5% SLA, 24h target on outages
          </dd>
        </dl>
      </section>
    </DocsShell>
  );
}
