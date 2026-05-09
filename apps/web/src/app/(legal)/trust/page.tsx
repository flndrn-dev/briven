export const metadata = { title: 'trust' };

export default function TrustPage() {
  return (
    <>
      <h1 className="font-mono text-2xl text-[var(--color-text)]">trust</h1>
      <p className="mt-2 font-mono text-xs text-[var(--color-text-subtle)]">
        last updated 2026-04-22 · phase 0 private alpha
      </p>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">where data lives</h2>
      <p>
        briven runs on a dedicated Hostinger KVM in Frankfurt (eu-west-1). Customer databases live
        in a shared Postgres 17 cluster (pgvector enabled) with one schema per project — every query
        is scoped to the project's schema at the application layer plus search_path at the
        connection layer. Team-tier projects graduate to a dedicated cluster.
      </p>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">encryption</h2>
      <ul className="mt-2 list-disc pl-6">
        <li>TLS 1.3 on every public endpoint, Let's Encrypt auto-renewed.</li>
        <li>Per-project env vars: AES-256-GCM at rest with a platform-held KEK.</li>
        <li>Session cookies: HTTP-only, SameSite=Lax, Secure in production.</li>
        <li>API keys: SHA-256 hashed, only the last 4 characters kept for display.</li>
      </ul>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">backups</h2>
      <p>
        pg_dump nightly to off-box object storage (Backblaze B2), 30-day retention. Restore drills
        monthly. Point-in-time recovery arrives in Phase 3.
      </p>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">access</h2>
      <p>
        SSH to the control-plane host is key-only; root password auth is disabled. Every
        platform-level mutation (deploy, member change, env edit, key revoke) is written to an
        append-only audit log tied to the authenticated actor. IPs are hashed before storage per our
        privacy policy.
      </p>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">incident disclosure</h2>
      <p>
        We will disclose incidents that affect customer data within 72 hours of detection to
        affected accounts and will publish a post-mortem here within 30 days. No incidents to report
        yet.
      </p>

      <h2 className="mt-10 font-mono text-lg text-[var(--color-text)]">open source</h2>
      <p>
        briven-core is AGPL-3.0. The CLI and client SDKs are MIT. Source lives at{' '}
        <a href="https://github.com/flndrn-dev/briven" className="text-[var(--color-text-link)]">
          github.com/flndrn-dev/briven
        </a>
        .
      </p>
    </>
  );
}
