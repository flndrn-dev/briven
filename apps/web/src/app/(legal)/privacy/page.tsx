import Link from 'next/link';

export const metadata = { title: 'privacy policy' };

export default function PrivacyPage() {
  return (
    <>
      <h1 className="font-mono text-2xl text-[var(--color-text)]">privacy policy</h1>
      <p className="mt-2 font-mono text-xs text-[var(--color-text-subtle)]">
        last updated 2026-05-10 · phase 0 private alpha
      </p>

      <p className="mt-8">
        This Privacy Policy explains what personal data the briven Service (briven.tech and any
        subdomain) collects, why, and what you can do about it. The Service is operated by{' '}
        <strong>flndrn</strong> (the &ldquo;Operator&rdquo;, also the data controller
        for the purposes of the EU General Data Protection Regulation), operating from
        Arch. Makariou III 171, Vanezis Business Center 4th floor, 3027 Limassol, Cyprus.
        Day-to-day development takes place in Flanders, Belgium. For brand and legal context see
        the <a href="/terms" className="text-[var(--color-text-link)]">Terms of Service</a>.
      </p>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">1. what we collect</h2>
      <p>We process the following categories of personal data:</p>
      <ul className="mt-2 list-disc pl-6">
        <li>
          <strong>Account data</strong> — email address (required), display name (optional),
          OAuth provider identifier and avatar URL (only if you sign in via Google).
        </li>
        <li>
          <strong>Project metadata</strong> — names you give projects, schemas you push,
          deployment timestamps, and a per-project audit log of mutations (who did what, when).
        </li>
        <li>
          <strong>Encrypted secrets</strong> — project env vars and API keys, encrypted at rest
          with AES-256-GCM. The Operator can never read these without your authenticated request.
        </li>
        <li>
          <strong>Operational telemetry</strong> — request paths, response codes, and latency on
          the API and dashboard. We use these to debug and to bill function-invocation usage.
        </li>
        <li>
          <strong>IP-derived identifiers</strong> — your IP address is hashed with a server-side
          pepper at the moment a request is logged. The plaintext IP is never written to disk.
          The hash is what appears in the audit log; it lets us correlate sessions for security
          investigations without de-anonymising you.
        </li>
        <li>
          <strong>Billing data</strong> (when paid tiers launch) — billing email and a token from
          our payment processor. We do not store card or bank-account details on briven
          infrastructure; the processor handles all of that.
        </li>
      </ul>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">2. what we do not collect</h2>
      <ul className="mt-2 list-disc pl-6">
        <li>
          <strong>The contents of your customer database.</strong> We operate the Postgres
          cluster and the runtime; we do not read your tables, rows, or function code outside of
          the support paths you explicitly authenticate.
        </li>
        <li>
          <strong>Third-party advertising cookies, marketing trackers, or session-replay tools.</strong>{' '}
          briven.tech ships zero analytics scripts to your browser.
        </li>
        <li>
          <strong>Plaintext IP addresses</strong>, browser fingerprints, or device identifiers
          for advertising purposes.
        </li>
      </ul>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">3. why we process it</h2>
      <p>The legal bases for processing under GDPR Article 6 are:</p>
      <ul className="mt-2 list-disc pl-6">
        <li>
          <strong>Contract</strong> (Art. 6(1)(b)) — to provide you the Service you signed up
          for: hosting your Postgres, running your functions, serving your dashboard.
        </li>
        <li>
          <strong>Legitimate interests</strong> (Art. 6(1)(f)) — security, abuse prevention, and
          operational debugging. The audit log and IP hashing fall under this basis.
        </li>
        <li>
          <strong>Legal obligation</strong> (Art. 6(1)(c)) — when a court order, regulatory
          subpoena, or DSA/DMA disclosure requirement compels us.
        </li>
        <li>
          <strong>Consent</strong> (Art. 6(1)(a)) — currently used only for optional product
          announcements; you can decline at sign-up and withdraw any time without affecting your
          access to the Service.
        </li>
      </ul>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">4. who we share with</h2>
      <p>
        We share data only with the third-party processors listed at{' '}
        <a href="/subprocessors" className="text-[var(--color-text-link)]">
          briven.tech/subprocessors
        </a>
        . Each one is bound by a data-processing agreement that limits them to the purpose for
        which we engage them. We do not sell personal data and do not rent it to advertisers.
        We disclose data to law enforcement only when required by binding legal process and we
        challenge over-broad demands where we can.
      </p>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">5. retention</h2>
      <ul className="mt-2 list-disc pl-6">
        <li>
          <strong>Account data</strong> — kept while your account is active. After account
          closure: 30-day soft-delete window during which you can restore, then permanent erasure.
        </li>
        <li>
          <strong>Project data</strong> — same: 30-day soft-delete after you close the project,
          then permanent erasure including from backups within 90 days.
        </li>
        <li>
          <strong>Audit logs</strong> — 13 months, then rotated. Required so we can investigate
          security incidents that surface late.
        </li>
        <li>
          <strong>Function invocation logs</strong> — 7 days for free-tier projects, 30 days for
          paid tiers (when applicable). Customer-controlled retention is on the roadmap.
        </li>
        <li>
          <strong>Backups</strong> — encrypted off-site backups are kept for 30 days then
          rotated. A deletion request runs through the active store immediately; backup
          deletion follows the 30-day rotation cycle.
        </li>
      </ul>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">6. security</h2>
      <p>
        TLS 1.3 on every public endpoint; AES-256-GCM for project env vars at rest; bcrypt for
        password hashes; SHA-256 for API key hashes; constant-time comparison on every secret
        check. SSH access to the host is key-only; root-password authentication is disabled.
        Dependency updates roll weekly. No system is ever fully secure; if you discover a
        vulnerability, please{' '}
        <Link href="/contact?topic=security" className="text-[var(--color-text-link)] underline">
          report it through our contact form
        </Link>{' '}
        rather than disclosing publicly.
      </p>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">
        7. international transfers
      </h2>
      <p>
        Your data is hosted in the EU (Hostinger Frankfurt VPS). Some of our subprocessors are
        located outside the EU; transfers to those processors rely on Standard Contractual
        Clauses approved by the European Commission, supplemented where appropriate by additional
        technical and organisational measures (encryption at rest and in transit, minimisation
        of data shared with each processor). The{' '}
        <a href="/subprocessors" className="text-[var(--color-text-link)]">
          subprocessors page
        </a>{' '}
        notes the location of each processor.
      </p>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">8. your rights</h2>
      <p>Under GDPR and equivalent laws, you have the right to:</p>
      <ul className="mt-2 list-disc pl-6">
        <li>
          <strong>access</strong> the personal data we hold about you;
        </li>
        <li>
          <strong>rectify</strong> inaccurate or incomplete data — most fields are user-editable
          in the Settings page;
        </li>
        <li>
          <strong>erase</strong> your data — open <a className="text-[var(--color-text-link)]" href="/dashboard/settings">Settings → Danger zone</a> and click <em>delete account</em>. We send a confirmation email the moment the request lands, soft-delete your projects and sole-owner orgs, revoke your API keys, and clear your PII (legal name, address, VAT id, display name, profile image) from our control plane. After the 30-day reversal window the row is hard-deleted and the data is unrecoverable. Multi-owner team orgs survive (you&apos;re removed from membership instead).
        </li>
        <li>
          <strong>port</strong> your data — <code>briven export --with-data</code> produces a
          portable JSON archive plus a pg_dump of every row;
        </li>
        <li>
          <strong>restrict</strong> or <strong>object</strong> to a specific processing purpose;
        </li>
        <li>
          <strong>withdraw</strong> any consent you previously gave;
        </li>
        <li>
          <strong>complain</strong> to your local data protection authority. The Operator&rsquo;s
          lead supervisory authority is the Belgian Data Protection Authority (Autorité de
          protection des données / Gegevensbeschermingsautoriteit).
        </li>
      </ul>
      <p className="mt-3">
        To exercise any of these rights,{' '}
        <Link href="/contact?topic=privacy" className="text-[var(--color-text-link)] underline">
          send us a privacy request
        </Link>
        . We answer within 72 hours and resolve within 30 days, extendable by 60 days for complex
        requests (we will tell you).
      </p>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">9. cookies</h2>
      <p>
        briven.tech sets exactly two cookies, both first-party and HTTP-only:
      </p>
      <ul className="mt-2 list-disc pl-6">
        <li>
          <strong>briven.session</strong> — your sign-in session, sent only to briven.tech and
          its subdomains. Cleared on sign-out or after 30 days of inactivity.
        </li>
        <li>
          <strong>briven.csrf</strong> — a per-session anti-CSRF token. Cleared with the session.
        </li>
      </ul>
      <p className="mt-3">
        We do not set advertising or analytics cookies. There is no consent banner because there
        is nothing to consent to that we don&rsquo;t already need to operate the Service.
      </p>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">10. children</h2>
      <p>
        briven is not directed to children under 16 and we do not knowingly collect their data.
        If you believe a child has signed up, contact us and we will erase the account.
      </p>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">11. updates</h2>
      <p>
        Material changes to this policy will be announced on briven.tech/changelog and emailed to
        the address on your account at least 30 days before they take effect. The
        &ldquo;last updated&rdquo; date at the top of this page reflects the most recent version.
      </p>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">12. contact</h2>
      <p>
        Privacy questions and rights requests:{' '}
        <Link href="/contact?topic=privacy" className="text-[var(--color-text-link)] underline">
          use our contact form
        </Link>{' '}
        and we&rsquo;ll route it to the right place. We answer within 72 hours.
      </p>
    </>
  );
}
