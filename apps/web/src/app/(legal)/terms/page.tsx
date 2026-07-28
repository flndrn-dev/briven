export const metadata = { title: 'Terms of Service · Briven' };

export default function TermsPage() {
  return (
    <>
      <h1 className="font-mono text-2xl text-[var(--color-text)]">Terms of Service</h1>
      <p className="mt-2 font-mono text-xs text-[var(--color-text-subtle)]">
        last updated 2026-07-28 · production · briven.tech
      </p>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">1. Who and what</h2>
      <p>
        Briven is a hosted backend platform (databases, Auth, storage, functions, dashboard) at{' '}
        <strong>briven.tech</strong> and its subdomains (the &ldquo;Service&rdquo;). It is operated
        by <strong>flndrn Limited</strong> (the &ldquo;Operator&rdquo;, &ldquo;we&rdquo;,
        &ldquo;us&rdquo;), registered at Arch. Makariou III 171, Vanezis Business Center 4th floor,
        3027 Limassol, Cyprus. Day-to-day operations are based in Flanders, Belgium.
      </p>
      <p className="mt-3">
        These Terms, together with the{' '}
        <a href="/privacy" className="text-[var(--color-text-link)]">
          Privacy Policy
        </a>
        ,{' '}
        <a href="/subprocessors" className="text-[var(--color-text-link)]">
          Subprocessors list
        </a>
        , and{' '}
        <a href="/trust" className="text-[var(--color-text-link)]">
          Trust page
        </a>
        , form the agreement between you (&ldquo;Customer&rdquo;, &ldquo;you&rdquo;) and the
        Operator. By creating an account or using the Service you accept these Terms.
      </p>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">2. Eligibility</h2>
      <p>
        You must be at least 16 years old and able to form a binding contract under the law of your
        jurisdiction. If you create an account for a company, you represent that you have authority
        to bind that company to these Terms.
      </p>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">3. Account</h2>
      <ul className="mt-2 list-disc pl-6">
        <li>
          You are responsible for your credentials and for access granted to teammates (API keys,
          machine clients, magic links, OAuth).
        </li>
        <li>
          You must keep a working email address on the account. We may suspend the account if mail
          repeatedly bounces and we cannot reach you about security or billing.
        </li>
        <li>
          Do not share a single human login across people. Invite teammates or use machine clients
          (M2M) for servers and jobs.
        </li>
      </ul>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">4. The Service</h2>
      <p>
        The Service includes, as enabled for your project: managed versioned Postgres (Doltgres),
        Briven Auth (end-user login, sessions, MFA, roles, machine clients), object storage,
        deployable functions, realtime where offered, Studio, and the operator dashboard at
        briven.tech. Feature availability depends on your plan and project configuration.
      </p>
      <p className="mt-3">
        Open-source components of Briven may be licensed under AGPL-3.0 (engine) and MIT (CLI /
        SDKs) as stated in the public repository. These Terms apply to the <strong>hosted</strong>{' '}
        Service only.
      </p>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">5. Acceptable use</h2>
      <p>You may not use the Service to:</p>
      <ul className="mt-2 list-disc pl-6">
        <li>store, transmit, or generate content that is illegal under EU or Belgian law;</li>
        <li>send unsolicited bulk email, spam, or abusive outbound traffic;</li>
        <li>
          host material that infringes copyright, trademark, or other third-party intellectual
          property;
        </li>
        <li>
          host CSAM, content that sexualises minors, or non-consensual intimate imagery — accounts
          hosting such material will be terminated immediately and reported to the appropriate
          authority;
        </li>
        <li>
          probe, scan, or attempt to compromise other tenants, the host infrastructure, or any
          system you do not own;
        </li>
        <li>
          run cryptocurrency mining, distributed computation for hire, or denial-of-service tools;
        </li>
        <li>
          resell the Service or run a separate commercial product on a free tier in a way that
          circumvents paid plans when those plans apply to your usage.
        </li>
      </ul>
      <p className="mt-3">
        We may remove offending content and suspend the responsible account without notice when the
        issue is severe (CSAM, active outbound attack, third-party legal demand). For other
        breaches we will give reasonable notice and a chance to cure where practical.
      </p>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">6. Your content</h2>
      <p>
        Your data is yours: schemas, rows, functions, files, Auth users for your apps, and project
        configuration. You keep all rights. You grant us only the limited licence needed to host
        and operate the Service (store, back up, process, and transmit content to clients you
        authorize).
      </p>
      <p className="mt-3">
        You can export project assets via the dashboard and CLI. We will not trap your data in a
        proprietary format we alone can read.
      </p>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">7. Fees and plans</h2>
      <p>
        Current plans and prices are published at{' '}
        <a href="/pricing" className="text-[var(--color-text-link)]">
          briven.tech/pricing
        </a>
        . Free or included usage (if any) is described there and in your dashboard. Paid features
        are billed according to the plan you select.
      </p>
      <p className="mt-3">
        Material price or plan changes will be announced on the site and, where we have a billing
        email, notified at least 30 days before they affect you. Taxes (VAT, GST, sales tax) may
        be added where the Operator is required to collect them. Card and bank details are handled
        by our payment subprocessor — see{' '}
        <a href="/subprocessors" className="text-[var(--color-text-link)]">
          Subprocessors
        </a>
        .
      </p>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">8. Availability and changes</h2>
      <p>
        The Service is offered for production use. We aim for continuous availability and maintain
        backups and operational practices described on the{' '}
        <a href="/trust" className="text-[var(--color-text-link)]">
          Trust page
        </a>
        . Unless you have a separate written SLA with flndrn Limited, the Service is provided
        without a contractual uptime percentage guarantee.
      </p>
      <p className="mt-3">
        We may improve, change, or retire features. Material removals that break documented
        behaviour will be announced with reasonable notice when possible. Emergency security
        changes may ship immediately.
      </p>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">
        9. Self-hosting open source
      </h2>
      <p>
        These Terms apply only to the hosted Service. If you run Briven software yourself from
        open-source releases, the applicable open-source licences apply; the Operator does not
        provide warranty or support for your self-hosted deployment under these Terms.
      </p>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">10. Intellectual property</h2>
      <p>
        The Briven name, logo, brand, and the design of briven.tech remain the Operator&rsquo;s
        property. Open-source code is licensed as stated in the repository. Nothing here transfers
        brand ownership to you.
      </p>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">
        11. Suspension and termination
      </h2>
      <ul className="mt-2 list-disc pl-6">
        <li>
          You may close your account from Settings. Deletion of project data follows the retention
          windows described in the Privacy Policy and dashboard; export before you delete if you
          need a copy.
        </li>
        <li>
          We may suspend or terminate accounts that violate Section 5, are in material breach of
          these Terms, or are subject to a binding legal demand. Where possible we give notice and
          an export window.
        </li>
        <li>
          We may discontinue the hosted Service with at least 90 days&rsquo; notice if continuing
          becomes commercially unviable; you may then self-host from open source where available.
        </li>
      </ul>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">12. Disclaimers</h2>
      <p>
        TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, the Service is provided &ldquo;as
        is&rdquo; and &ldquo;as available&rdquo;. The Operator disclaims warranties of
        merchantability, fitness for a particular purpose, and non-infringement, except where
        mandatory law forbids that disclaimer. Nothing here limits non-waivable consumer rights
        under EU law.
      </p>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">
        13. Limitation of liability
      </h2>
      <p>
        TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, the Operator&rsquo;s total liability for
        claims arising out of these Terms or the Service is limited to the greater of (a) fees you
        paid for the Service in the 12 months before the claim, or (b) €100. The Operator is not
        liable for indirect, incidental, special, consequential, or punitive damages, or for lost
        profits or lost data where recovery is reasonably available from your own backups. Nothing
        limits liability for fraud, gross negligence, or liability that cannot be excluded under
        mandatory law.
      </p>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">14. Indemnification</h2>
      <p>
        You will indemnify and hold the Operator harmless from third-party claims arising from (a)
        your content, (b) your use of the Service in breach of these Terms, or (c) your violation
        of law. We will give prompt notice and reasonable cooperation; you control the defence
        subject to our consent for settlements that admit our fault or bind us non-monetarily.
      </p>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">15. Changes to these Terms</h2>
      <p>
        We may update these Terms. Material changes will be posted on this page with a new
        &ldquo;last updated&rdquo; date and, for material changes, emailed to the address on your
        account when practical, at least 30 days before they take effect. Continued use after the
        effective date is acceptance. If you disagree, close your account before that date.
      </p>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">16. Governing law</h2>
      <p>
        These Terms are governed by Belgian law. Disputes that cannot be resolved amicably are
        subject to the exclusive jurisdiction of the courts of Antwerp, Belgium, without limiting
        non-waivable consumer rights in your country. The English version controls if translations
        conflict.
      </p>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">17. Contact</h2>
      <p>
        Legal: <strong>legal@flndrn.com</strong>. Support:{' '}
        <strong>support@flndrn.com</strong>. Security:{' '}
        <strong>security@flndrn.com</strong> (see Trust page for disclosure practice). Mail to
        those addresses is handled by the Operator.
      </p>
    </>
  );
}
