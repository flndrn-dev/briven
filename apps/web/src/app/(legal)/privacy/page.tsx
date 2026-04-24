export const metadata = { title: 'privacy' };

export default function PrivacyPage() {
  return (
    <>
      <h1 className="font-mono text-2xl text-[var(--color-text)]">privacy policy</h1>
      <p className="mt-2 font-mono text-xs text-[var(--color-text-subtle)]">
        last updated 2026-04-22 · phase 0 private alpha · not yet reviewed by counsel
      </p>

      <p className="mt-8">
        briven is operated by an individual developer based in the EU (the &ldquo;operator&rdquo;).
        This page explains what the platform stores about you and how long.
      </p>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">what we collect</h2>
      <ul className="mt-2 list-disc pl-6">
        <li>
          <strong>Account:</strong> email address (required for sign-in), optional name, optional
          GitHub OAuth identifier.
        </li>
        <li>
          <strong>Projects and keys:</strong> names, metadata, encrypted env vars.
        </li>
        <li>
          <strong>Usage:</strong> request paths and response codes on the API; per-project audit log
          of mutations.
        </li>
      </ul>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">what we do not collect</h2>
      <ul className="mt-2 list-disc pl-6">
        <li>
          <strong>IP addresses are never stored in cleartext.</strong> They are hashed with a
          server-side pepper before being written to the audit log.
        </li>
        <li>Third-party analytics, marketing cookies, or session replay.</li>
        <li>
          The contents of customer database rows — we operate the cluster, we don&rsquo;t read it.
        </li>
      </ul>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">retention</h2>
      <p>
        Account and project data persists for as long as your account is active. Deleting a project
        soft-deletes immediately and hard-deletes after 30 days. Audit logs retain for 13 months,
        then rotate.
      </p>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">your rights</h2>
      <p>
        You can export every byte of your account with one command (briven cli export), request
        deletion via the Settings page, or email <em>privacy@briven.cloud</em> for any GDPR request
        (access, rectification, erasure, portability, restriction, objection).
      </p>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">subprocessors</h2>
      <ul className="mt-2 list-disc pl-6">
        <li>Hostinger — compute + bandwidth, EU</li>
        <li>Resend — transactional email (magic links only)</li>
        <li>Backblaze B2 — encrypted backups, EU</li>
        <li>Cloudflare — DNS</li>
      </ul>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">contact</h2>
      <p>privacy@briven.cloud — answered within 72 hours.</p>
    </>
  );
}
