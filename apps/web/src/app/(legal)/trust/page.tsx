export const metadata = { title: 'trust' };

export default function TrustPage() {
  return (
    <>
      <h1 className="font-mono text-2xl text-[var(--color-text)]">trust</h1>
      <p className="mt-2 font-mono text-xs text-[var(--color-text-subtle)]">
        last updated 2026-07-28 · production · operated by flndrn Limited (Cyprus)
      </p>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">enterprise auth</h2>
      <p>
        Briven Auth is built for multi-app products that need day-to-day login <em>and</em> company
        IT controls. Enterprise surfaces include:
      </p>
      <ul className="mt-2 list-disc pl-6">
        <li>
          <strong>SAML 2.0 + OIDC SSO</strong> — employees sign in with the company identity
          provider (Okta, Entra, Google Workspace, custom OIDC).
        </li>
        <li>
          <strong>SCIM 2.0</strong> — HR/IT systems can auto-add and remove users (and map groups
          into Briven orgs).
        </li>
        <li>
          <strong>Compliance pack</strong> — DPA / BAA templates and retention notes available to
          project owners via the dashboard API (sales kit). Final contracts are signed with flndrn
          Limited; flags are recorded per project after signature.
        </li>
        <li>
          <strong>Audit + retention</strong> — auth audit and app logs with configurable retention
          windows.
        </li>
      </ul>
      <p className="mt-2">
        Subprocessors list:{' '}
        <a href="/subprocessors" className="text-[var(--color-text-link)]">
          /subprocessors
        </a>
        . Status:{' '}
        <a href="/status" className="text-[var(--color-text-link)]">
          /status
        </a>
        .
      </p>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">where data lives</h2>
      <p>
        Production API runs in the EU (France host for api.briven.tech). Customer project data is
        isolated per project in the data plane. Team and enterprise needs (dedicated capacity,
        residency questions) are handled case-by-case — contact sales / legal.
      </p>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">encryption</h2>
      <ul className="mt-2 list-disc pl-6">
        <li>TLS on every public endpoint.</li>
        <li>Per-project env vars: AES-256-GCM at rest with a platform-held KEK.</li>
        <li>Session cookies: HTTP-only, Secure in production.</li>
        <li>API / SCIM / SDK keys: SHA-256 hashed; only short suffixes displayed.</li>
      </ul>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">access &amp; audit</h2>
      <p>
        Platform mutations (deploy, member change, env edit, key revoke) are written to an
        append-only audit log. Auth-tenant events live in the project&apos;s auth audit stream.
        IPs are hashed before storage where privacy policy requires it.
      </p>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">incident disclosure</h2>
      <p>
        We aim to disclose incidents that affect customer data within 72 hours of detection to
        affected accounts and publish a post-mortem here within 30 days when material. Report
        security issues to <strong>security@flndrn.com</strong>.
      </p>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">legal contacts</h2>
      <p>
        Privacy &amp; DPA: legal@flndrn.com · Operator: flndrn Limited, Limassol, Cyprus. Terms and
        privacy live under this site&apos;s legal section.
      </p>
    </>
  );
}
