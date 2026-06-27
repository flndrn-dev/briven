import Link from 'next/link';

export const metadata = { title: 'subprocessors' };

interface Subprocessor {
  name: string;
  purpose: string;
  location: string;
  status: 'active' | 'planned';
  notes?: string;
}

const SUBPROCESSORS: readonly Subprocessor[] = [
  {
    name: 'Hostinger International Ltd.',
    purpose: 'VPS hosting (compute, bandwidth, host disk for control + data plane)',
    location: 'Lithuania (HQ); Frankfurt, Germany (data centre)',
    status: 'active',
    notes:
      'Customer Postgres, runtime isolates, backups, and the dashboard all run on a Hostinger KVM in Frankfurt.',
  },
  {
    name: "Let's Encrypt (Internet Security Research Group)",
    purpose: 'Issuance of TLS certificates for briven.tech and its subdomains',
    location: 'United States (CA-domiciled)',
    status: 'active',
    notes:
      'No personal data is shared beyond the public domain name being certified. Renewals are automatic via ACME.',
  },
  {
    name: 'Mittera by flndrn',
    purpose: 'Transactional email delivery (magic-link sign-in, email verification, project invitations, account notices)',
    location: 'Limassol, Cyprus (EU)',
    status: 'active',
    notes:
      "Sister product to briven, also operated by flndrn. Outbound sends authenticate with a Bearer API key (POST https://api.mittera.eu/api/v1/emails); delivery / bounce / complaint events come back to https://api.briven.tech/mittera-webhook signed with HMAC-SHA256 of `${ts_ms}.${body}` and verified against BRIVEN_MITTERA_WEBHOOK_SECRET.",
  },
  {
    name: 'Katsuro by flndrn',
    purpose: 'Code monitoring (logs, errors, and uptime/health monitoring for the briven platform)',
    location: 'Limassol, Cyprus (EU)',
    status: 'active',
    notes:
      'Sister product to briven, also operated by flndrn. Receives platform operational logs and health signals so we can detect and resolve incidents. Customer database contents are never sent to Katsuro.',
  },
  {
    name: 'Polar Software Inc.',
    purpose: 'Subscription billing, checkout, invoicing, taxation',
    location: 'United States; EU-resident processors via Stripe Connect',
    status: 'active',
    notes:
      'Polar handles all card data; no card details ever touch briven infrastructure.',
  },
  {
    name: 'Backblaze, Inc. (B2 Cloud Storage)',
    purpose: 'Off-site encrypted backup storage for nightly Postgres dumps',
    location: 'United States; EU mirror available',
    status: 'planned',
    notes:
      'Encryption keys remain on briven infrastructure; B2 receives only ciphertext. EU mirror selected when activated.',
  },
  {
    name: 'Codeberg (codeberg.org)',
    purpose: 'Source code hosting; CI artifact storage',
    location: 'EU (operator-controlled)',
    status: 'active',
    notes:
      'No customer data flows to Codeberg. Public source only. Listed for transparency about where the briven codebase lives.',
  },
  {
    name: 'Google Cloud (Google LLC)',
    purpose: 'OAuth identity (Sign in with Google)',
    location: 'United States; EU points of presence',
    status: 'active',
    notes:
      'Engaged only if you choose to sign in via Google. We receive your name, email, and avatar URL; we send Google nothing about your briven activity.',
  },
];

export default function SubprocessorsPage() {
  return (
    <>
      <h1 className="font-mono text-2xl text-[var(--color-text)]">subprocessors</h1>
      <p className="mt-2 font-mono text-xs text-[var(--color-text-subtle)]">
        last updated 2026-05-10 · phase 0 private alpha
      </p>

      <p className="mt-8">
        This page lists every third-party service that processes briven Customer data on behalf
        of <strong>flndrn</strong> (the Operator), a company registered at Arch. Makariou
        III 171, Vanezis Business Center 4th floor, 3027 Limassol, Cyprus. Where a subprocessor
        is &ldquo;planned&rdquo;, the integration exists in code but is disabled until the
        corresponding configuration is provided; we list them here so you can audit what your
        account will be exposed to as features turn on.
      </p>

      <p className="mt-4">
        Each subprocessor is engaged under a data-processing agreement that limits them to the
        purpose stated below. Transfers outside the EU rely on Standard Contractual Clauses with
        appropriate supplementary measures (TLS in transit, AES-256 at rest, minimisation of
        what we send to each processor).
      </p>

      <div className="mt-10 overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse font-mono text-xs">
        <thead>
          <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-text-muted)]">
            <th className="py-2 pr-4 font-medium">subprocessor</th>
            <th className="py-2 pr-4 font-medium">purpose</th>
            <th className="py-2 pr-4 font-medium">location</th>
            <th className="py-2 pr-4 font-medium">status</th>
          </tr>
        </thead>
        <tbody>
          {SUBPROCESSORS.map((sp) => (
            <tr
              key={sp.name}
              className="border-b border-[var(--color-border-subtle)] align-top"
            >
              <td className="py-3 pr-4 text-[var(--color-text)]">{sp.name}</td>
              <td className="py-3 pr-4 text-[var(--color-text-muted)]">
                {sp.purpose}
                {sp.notes ? (
                  <span className="mt-1 block text-[var(--color-text-subtle)]">{sp.notes}</span>
                ) : null}
              </td>
              <td className="py-3 pr-4 text-[var(--color-text-muted)]">{sp.location}</td>
              <td className="py-3 pr-4">
                {sp.status === 'active' ? (
                  <span className="inline-flex rounded-md bg-[var(--color-primary-subtle)] px-2 py-0.5 text-[var(--color-primary)]">
                    active
                  </span>
                ) : (
                  <span className="inline-flex rounded-md bg-[var(--color-surface-raised)] px-2 py-0.5 text-[var(--color-text-subtle)]">
                    planned
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      <h2 className="mt-12 font-mono text-lg text-[var(--color-text)]">
        change-notification policy
      </h2>
      <p>
        We will publish material changes to this list at least 30 days before a new subprocessor
        starts processing customer data. &ldquo;Material&rdquo; means: adding a subprocessor,
        replacing one with a substantively different service, or expanding the scope of an
        existing subprocessor&rsquo;s access to a category of data not previously covered.
        Notifications appear on briven.tech/changelog and are emailed to account owners.
      </p>
      <p className="mt-3">
        If a subprocessor change is unacceptable for your use case, you may close your account
        and export your data without penalty within 30 days of the notice.
      </p>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">questions</h2>
      <p>
        Use our{' '}
        <Link href="/contact?topic=privacy" className="text-[var(--color-text-link)] underline">
          contact form
        </Link>{' '}
        for any subprocessor-related question, including requests for the underlying
        data-processing agreements where they are not publicly available.
      </p>
    </>
  );
}
