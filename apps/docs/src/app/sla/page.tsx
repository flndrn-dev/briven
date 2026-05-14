import Link from 'next/link';

import { DocsShell } from '../../components/shell';

export const metadata = { title: 'service level agreement' };

export default function SlaPage() {
  return (
    <DocsShell>
      <h1 className="font-mono text-2xl tracking-tight">service level agreement</h1>
      <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
        the uptime briven commits to per tier, how monthly credits are calculated when we miss it,
        and what counts as "downtime" for purposes of this agreement. effective date{' '}
        <strong>2026-05-21</strong> (Phase 4 public-beta launch). free-tier projects are best-effort
        with no contractual commitment.
      </p>

      <Section title="commitments">
        <table className="mt-2 w-full border-collapse font-mono text-xs">
          <thead>
            <tr className="border-b border-[var(--color-border-subtle)] text-left text-[var(--color-text-muted)]">
              <th className="py-2 pr-4 font-normal">tier</th>
              <th className="py-2 pr-4 font-normal">monthly uptime target</th>
              <th className="py-2 pr-4 font-normal">credit if missed</th>
            </tr>
          </thead>
          <tbody className="text-[var(--color-text)]">
            <tr className="border-b border-[var(--color-border-subtle)]">
              <td className="py-2 pr-4">free</td>
              <td className="py-2 pr-4 text-[var(--color-text-subtle)]">best-effort</td>
              <td className="py-2 pr-4 text-[var(--color-text-subtle)]">none</td>
            </tr>
            <tr className="border-b border-[var(--color-border-subtle)]">
              <td className="py-2 pr-4">pro</td>
              <td className="py-2 pr-4">99.5%</td>
              <td className="py-2 pr-4">see schedule below</td>
            </tr>
            <tr>
              <td className="py-2 pr-4">team</td>
              <td className="py-2 pr-4">99.9%</td>
              <td className="py-2 pr-4">see schedule below</td>
            </tr>
          </tbody>
        </table>
      </Section>

      <Section title="what counts as the platform being up">
        <p>three signals, measured externally from outside the briven infrastructure:</p>
        <ul className="list-disc pl-5">
          <li>
            <code>api.briven.tech/ready</code> returns HTTP 200 within 5 seconds. probes every 60s.
          </li>
          <li>
            <code>realtime.briven.tech/ready</code> returns HTTP 200 within 5 seconds. probes every
            60s.
          </li>
          <li>
            a function invocation to a healthy deployment in your project returns within 10 seconds
            for at least one randomly selected hosted project per region. probes every 5 minutes.
          </li>
        </ul>
        <p>
          a probe failure counts as downtime when at least three consecutive probes fail (so a
          single packet drop doesn't trigger the SLA). downtime accumulates per calendar month UTC.
          the monthly uptime % is calculated as{' '}
          <code>1 - (downtime_minutes / total_minutes_in_month)</code>.
        </p>
      </Section>

      <Section title="credit schedule">
        <p>
          if your tier's monthly uptime falls below the commitment, your next monthly invoice is
          credited per the table below. credits are automatic — you don't need to file a ticket
          unless we miss applying the credit, but you can confirm via <code>briven doctor --month</code>{' '}
          or the dashboard billing page.
        </p>
        <table className="mt-2 w-full border-collapse font-mono text-xs">
          <thead>
            <tr className="border-b border-[var(--color-border-subtle)] text-left text-[var(--color-text-muted)]">
              <th className="py-2 pr-4 font-normal">measured uptime</th>
              <th className="py-2 pr-4 font-normal">pro credit</th>
              <th className="py-2 pr-4 font-normal">team credit</th>
            </tr>
          </thead>
          <tbody className="text-[var(--color-text)]">
            <tr className="border-b border-[var(--color-border-subtle)]">
              <td className="py-2 pr-4">target met</td>
              <td className="py-2 pr-4 text-[var(--color-text-subtle)]">—</td>
              <td className="py-2 pr-4 text-[var(--color-text-subtle)]">—</td>
            </tr>
            <tr className="border-b border-[var(--color-border-subtle)]">
              <td className="py-2 pr-4">&lt; tier target but ≥ 99.0%</td>
              <td className="py-2 pr-4">10% of the month&apos;s subscription</td>
              <td className="py-2 pr-4">10% of the month&apos;s subscription</td>
            </tr>
            <tr className="border-b border-[var(--color-border-subtle)]">
              <td className="py-2 pr-4">&lt; 99.0% but ≥ 95.0%</td>
              <td className="py-2 pr-4">25%</td>
              <td className="py-2 pr-4">25%</td>
            </tr>
            <tr>
              <td className="py-2 pr-4">&lt; 95.0%</td>
              <td className="py-2 pr-4">50%</td>
              <td className="py-2 pr-4">50%</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-3 text-[var(--color-text-subtle)]">
          credit applies to the affected month&apos;s subscription fee. overage and metered usage
          aren&apos;t credited. credits never roll over into cash refunds; they offset future
          invoices.
        </p>
      </Section>

      <Section title="what's excluded">
        <p>downtime caused by any of the following does not count against the SLA:</p>
        <ul className="list-disc pl-5">
          <li>scheduled maintenance announced ≥ 48h in advance on the status page</li>
          <li>incidents caused by the customer's own code (e.g. a function that 500s under load) or by the customer&apos;s own configuration changes</li>
          <li>incidents caused by upstream provider failures (Hostinger, Cloudflare, Polar, Mittera) where briven&apos;s mitigation is to wait for the upstream</li>
          <li>force majeure: natural disasters, war, government action, internet-scale BGP events</li>
          <li>any period during which the customer is in breach of the Terms of Service or has overdue invoices</li>
          <li>downtime affecting only free-tier projects — they&apos;re best-effort by design</li>
        </ul>
      </Section>

      <Section title="how downtime is measured">
        <p>
          briven publishes its own external probes at{' '}
          <Link
            href="/status"
            className="text-[var(--color-text-link)] underline-offset-2 hover:underline"
          >
            docs.briven.tech/status
          </Link>{' '}
          and{' '}
          <Link
            href="https://briven.tech/status"
            className="text-[var(--color-text-link)] underline-offset-2 hover:underline"
          >
            briven.tech/status
          </Link>
          . additionally, a third-party probe (Uptime Kuma on a separate provider) records minute-
          level availability for each public surface. monthly uptime is calculated from the
          third-party probe data — never from internal logs alone.
        </p>
        <p>
          on disagreement, the third-party probe&apos;s record is authoritative for the calculation;
          customers may inspect the same data at the public status page&apos;s history view.
        </p>
      </Section>

      <Section title="filing a claim">
        <p>
          credits are automatic and applied to the next invoice. if you believe a credit was missed,
          email{' '}
          <a href="mailto:billing@flndrn.com" className="text-[var(--color-text-link)] hover:underline">
            billing@flndrn.com
          </a>{' '}
          within 30 days of the affected month with your project id and the time window in
          question. claims older than 30 days are ineligible.
        </p>
      </Section>

      <Section title="changes to this SLA">
        <p>
          briven may update the SLA with 30 days&apos; notice posted to the public changelog. the
          version of this page in effect on the first day of your billing month governs that
          month&apos;s credits.
        </p>
      </Section>

      <p className="mt-12 font-mono text-xs text-[var(--color-text-subtle)]">
        flndrn Limited, Limassol, Cyprus · this document is the SLA referenced in the briven Terms
        of Service.
      </p>
    </DocsShell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10 flex flex-col gap-3 font-sans text-sm text-[var(--color-text-muted)]">
      <h2 className="font-mono text-lg tracking-tight text-[var(--color-text)]">{title}</h2>
      {children}
    </section>
  );
}
