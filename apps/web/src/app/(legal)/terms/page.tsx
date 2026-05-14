export const metadata = { title: 'terms of service' };

export default function TermsPage() {
  return (
    <>
      <h1 className="font-mono text-2xl text-[var(--color-text)]">terms of service</h1>
      <p className="mt-2 font-mono text-xs text-[var(--color-text-subtle)]">
        last updated 2026-05-10 · phase 0 private alpha
      </p>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">1. who and what</h2>
      <p>
        briven is an open-core reactive Postgres backend platform operated by{' '}
        <strong>flndrn Limited</strong> (the &ldquo;Operator&rdquo;, &ldquo;we&rdquo;,
        &ldquo;us&rdquo;), a company registered at Arch. Makariou III 171, Vanezis Business
        Center 4th floor, 3027 Limassol, Cyprus. Day-to-day development happens in Flanders,
        Belgium. This document, together with the{' '}
        <a href="/privacy" className="text-[var(--color-text-link)]">
          Privacy Policy
        </a>{' '}
        and{' '}
        <a href="/subprocessors" className="text-[var(--color-text-link)]">
          Subprocessors list
        </a>
        , is the agreement between you (&ldquo;Customer&rdquo;) and the Operator for use of
        briven.tech and any subdomain (collectively the &ldquo;Service&rdquo;). By creating an
        account or using the Service you accept these Terms.
      </p>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">2. eligibility</h2>
      <p>
        You must be at least 16 years old and able to form a binding contract under the law of
        your jurisdiction. If you are creating an account on behalf of a company, you represent
        that you have authority to bind that company to these Terms.
      </p>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">3. account</h2>
      <ul className="mt-2 list-disc pl-6">
        <li>
          You are responsible for the security of your credentials. Magic-link emails and OAuth
          tokens are issued only to the email you sign in with — protect that mailbox.
        </li>
        <li>
          You must provide a valid email address. We may suspend an account if email delivery
          repeatedly bounces.
        </li>
        <li>
          One natural person, one account. Sharing credentials between humans is not allowed;
          invite team members instead.
        </li>
      </ul>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">4. the service</h2>
      <p>
        briven gives you a managed Postgres database with reactive queries, a typed schema DSL,
        a deno-based functions runtime, and a dashboard for managing all of the above. The
        engine (apps/api, runtime, realtime, web, docs) is licensed under{' '}
        <strong>AGPL-3.0</strong> and is freely self-hostable; the CLI and client SDKs
        (@briven/cli, @briven/react, @briven/svelte, @briven/vue, @briven/client) are licensed
        under <strong>MIT</strong>. Source lives at{' '}
        <a href="https://code.konnos.org/flndrn/briven" className="text-[var(--color-text-link)]">
          code.konnos.org/flndrn/briven
        </a>
        .
      </p>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">5. acceptable use</h2>
      <p>You may not use briven to:</p>
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
          run a production workload for a separate paying entity on the free or personal tier —
          please use the appropriate paid tier or self-host.
        </li>
      </ul>
      <p className="mt-3">
        We may remove offending content and suspend the responsible account without notice when
        the issue is severe (CSAM, active outbound attack, third-party legal demand). For other
        breaches we will give you reasonable notice and a chance to cure.
      </p>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">6. your content</h2>
      <p>
        Your data is yours. The schema you author, the rows in your Postgres database, the
        functions you deploy, the project env vars — you keep all rights to all of it. You grant
        us only the limited, non-exclusive, royalty-free licence required to host and serve the
        Service: to read, store, back up, and transmit your content to the clients you authenticate.
      </p>
      <p className="mt-3">
        At any time you can run <code>briven export --with-data</code> to take a portable JSON
        archive of your project plus a pg_dump of every row. We will never lock your data inside
        a proprietary format.
      </p>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">7. fees</h2>
      <p>
        During the private alpha (Phase 0) the Service is free of charge. When paid tiers
        (Pro, Team) launch, the price and the features they include will be documented at
        briven.tech/pricing and announced in the changelog at least 30 days before billing starts.
        Existing accounts will retain free access to the features they had during the alpha for at
        least 30 days after billing starts so you have time to choose a plan.
      </p>
      <p className="mt-3">
        Fees, when due, will be charged via{' '}
        <a href="/subprocessors" className="text-[var(--color-text-link)]">
          our payment processor
        </a>{' '}
        and exclude any applicable taxes (VAT, GST, sales tax) which we will collect and remit
        where we are obliged to.
      </p>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">8. alpha disclaimer</h2>
      <p>
        Phase 0 of briven is an early-access alpha. We make <strong>no uptime guarantee</strong>{' '}
        during alpha and may change, deprecate, or remove features with one week&rsquo;s
        notice. Data is backed up nightly with off-site storage; restore drills run monthly. See
        the <a href="/trust" className="text-[var(--color-text-link)]">trust page</a> for details
        on backup, encryption, and incident disclosure.
      </p>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">
        9. open-source self-hosting
      </h2>
      <p>
        These Terms apply only to the hosted Service at briven.tech. If you self-host briven from
        the AGPL-3.0 source, you are bound by the AGPL but not by this agreement; the Operator
        provides no warranty or support for your self-hosted deployment, and your relationship
        with the AGPL applies as written. Commercial-licence carve-outs for use cases incompatible
        with AGPL are available on request.
      </p>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">
        10. intellectual property
      </h2>
      <p>
        The briven name, logo, brand, and the design of briven.tech remain the Operator&rsquo;s
        property. The source code is licensed under AGPL-3.0 (engine) and MIT (CLI/SDKs) — refer
        to the <code>LICENSE</code> files in the repository for the full terms. Nothing in this
        agreement transfers ownership of the brand to you.
      </p>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">11. suspension and termination</h2>
      <ul className="mt-2 list-disc pl-6">
        <li>
          You can close your account any time from the Settings page. Closure is immediate;
          deletion follows in 30 days, during which you may restore. After 30 days the account
          and all project data are erased and unrecoverable.
        </li>
        <li>
          We may suspend or terminate accounts that violate Section 5 (acceptable use), are
          materially in breach of any other section of these Terms, or are subject to a binding
          legal demand. Where possible we will give notice and offer a final export window.
        </li>
        <li>
          We may terminate the Service in its entirety on 90 days&rsquo; notice if continuing
          becomes commercially unviable. In that event you can self-host without our involvement
          using the AGPL source.
        </li>
      </ul>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">12. disclaimers</h2>
      <p>
        TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, the Service is provided &ldquo;as
        is&rdquo; and &ldquo;as available&rdquo;. The Operator disclaims all warranties, express or
        implied, including merchantability, fitness for a particular purpose, and non-infringement.
        Nothing in this section limits any rights you have under EU consumer-protection law that
        cannot be waived by contract.
      </p>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">13. limitation of liability</h2>
      <p>
        TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, the Operator&rsquo;s total liability for
        any claim arising out of or related to these Terms is limited to the greater of (a) fees
        you paid for the Service in the 12 months preceding the claim, or (b) €100. The Operator
        is not liable for indirect, incidental, special, consequential, or punitive damages, or
        for lost profits, lost data (where the loss is recoverable from your own backups), or
        business interruption. Nothing in this section limits liability for fraud, gross
        negligence, or any liability that cannot be excluded under mandatory law.
      </p>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">14. indemnification</h2>
      <p>
        You agree to indemnify and hold the Operator harmless from any third-party claim arising
        from (a) your content, (b) your use of the Service in breach of these Terms, or (c) your
        violation of applicable law. We will give you prompt notice of any covered claim and
        reasonable cooperation; you control the defence and any settlement subject to our prior
        consent for terms that admit fault or non-monetary obligation on us.
      </p>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">15. modifications</h2>
      <p>
        We may update these Terms. Material changes will be announced on briven.tech/changelog and
        emailed to the address on your account at least 30 days before they take effect.
        Continuing to use the Service after the effective date constitutes acceptance; if you
        disagree, close your account before the effective date.
      </p>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">16. governing law</h2>
      <p>
        These Terms are governed by Belgian law. Any dispute that cannot be resolved amicably will
        be submitted to the exclusive jurisdiction of the courts of Antwerp, Belgium. The
        English-language version of these Terms controls in the event of any translation
        conflict. Nothing in this section limits any non-waivable rights you have under your local
        consumer-protection law.
      </p>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">17. contact</h2>
      <p>
        Legal notices: <strong>legal@flndrn.com</strong>. Operational issues:{' '}
        <strong>support@flndrn.com</strong>. Security disclosures:{' '}
        <strong>security@flndrn.com</strong> (PGP key on the trust page). Until brand-fronted
        email is fully wired up, mail to those addresses is forwarded to{' '}
        <strong>flandriendev@hotmail.com</strong>.
      </p>
    </>
  );
}
