export const metadata = { title: 'terms' };

export default function TermsPage() {
  return (
    <>
      <h1 className="font-mono text-2xl text-[var(--color-text)]">terms of service</h1>
      <p className="mt-2 font-mono text-xs text-[var(--color-text-subtle)]">
        last updated 2026-04-22 · phase 0 private alpha · not yet reviewed by counsel
      </p>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">who and what</h2>
      <p>
        briven is an open-core reactive postgres platform operated by an individual EU developer.
        By creating an account you agree to these terms.
      </p>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">acceptable use</h2>
      <ul className="mt-2 list-disc pl-6">
        <li>No illegal content under applicable EU law.</li>
        <li>No unsolicited bulk email or abusive outbound traffic.</li>
        <li>No attempt to probe other tenants or the host infrastructure.</li>
        <li>
          No workloads that use the free / personal tier to serve production for a separate
          paying entity — use a paid tier or self-host.
        </li>
      </ul>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">phase 0 alpha</h2>
      <p>
        During private alpha we make <strong>no uptime guarantee</strong> and may change,
        deprecate, or remove features with one week&rsquo;s notice. Data is backed up nightly; see
        the <a href="/trust" className="text-[var(--color-text-link)]">trust page</a> for details.
      </p>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">your content</h2>
      <p>
        You retain all rights to the data you put on briven. You grant us only the limited
        licence required to operate the service — store, back up, and serve it to clients you
        authenticate.
      </p>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">termination</h2>
      <p>
        You can close your account any time via the Settings page. We may suspend or terminate
        accounts that violate these terms with reasonable notice and a full export opportunity
        where possible.
      </p>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">liability</h2>
      <p>
        briven is provided &ldquo;as is&rdquo; during alpha. The operator&rsquo;s liability is
        capped at the fees paid (which are currently zero). This clause will be tightened when
        counsel reviews before Phase 3.
      </p>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">governing law</h2>
      <p>Belgian law, Antwerp courts. English-language version controlling.</p>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">contact</h2>
      <p>legal@briven.cloud</p>
    </>
  );
}
