import Link from 'next/link';

import { DocsShell } from '../../components/shell';

export const metadata = { title: 'trust + security' };

export default function TrustPage() {
  return (
    <DocsShell>
      <h1 className="font-mono text-2xl tracking-tight">trust + security</h1>
      <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
        how to report a vulnerability, what&apos;s in scope, and the commitments we make to
        security researchers who report in good faith. briven is open-core — the engine lives in
        a public repo — so we expect (and welcome) scrutiny.
      </p>

      <Section title="reporting a vulnerability">
        <p>
          report security issues through{' '}
          <Link
            href="https://briven.tech/contact?topic=security"
            className="text-[var(--color-text-link)] underline-offset-2 hover:underline"
          >
            the security topic on our contact form
          </Link>
          . it routes straight to the maintainer — please don&apos;t open a public GitHub issue
          for anything exploitable, and don&apos;t post it on social media before we&apos;ve had a
          chance to fix it.
        </p>
        <p>a useful report includes:</p>
        <ul className="list-disc pl-5">
          <li>the affected surface (URL, endpoint, package, or repo path) and the version / build sha</li>
          <li>a clear description of the issue and its impact</li>
          <li>reproduction steps — a minimal proof-of-concept beats a long writeup</li>
          <li>any logs or screenshots, with secrets and real personal data redacted</li>
        </ul>
        <p>
          a <strong>PGP key is available on request</strong> if you need to send the report
          encrypted — ask for it via the contact form and we&apos;ll provide the fingerprint and
          public key before you send anything sensitive.
        </p>
      </Section>

      <Section title="our response targets">
        <p>once you&apos;ve reported, here is what to expect:</p>
        <ul className="list-disc pl-5">
          <li>
            <strong>acknowledgement</strong> — within one business day (Flanders / EU business
            hours).
          </li>
          <li>
            <strong>triage + severity assessment</strong> — within five business days, with an
            initial view on validity and severity.
          </li>
          <li>
            <strong>fix + disclosure</strong> — timeline depends on severity. critical issues are
            prioritised immediately; we&apos;ll keep you updated and credit you in the changelog
            (or stay anonymous if you prefer) once a fix ships.
          </li>
        </ul>
      </Section>

      <Section title="responsible disclosure + safe harbour">
        <p>
          we will not pursue or support legal action against you for security research conducted
          in good faith that follows this policy. specifically, if you:
        </p>
        <ul className="list-disc pl-5">
          <li>make a good-faith effort to avoid privacy violations, data destruction, and service degradation;</li>
          <li>only interact with accounts you own or have explicit permission to test;</li>
          <li>do not exfiltrate, retain, or share more data than is necessary to demonstrate the issue;</li>
          <li>give us a reasonable window to remediate before any public disclosure;</li>
        </ul>
        <p>
          then we consider your research authorised, we won&apos;t treat it as a violation of our
          terms of service, and we&apos;ll work with you to understand and resolve the issue
          quickly. if a third party brings action against you for activity that complied with this
          policy, we&apos;ll make it known that your actions were authorised.
        </p>
      </Section>

      <Section title="scope">
        <p>
          <strong>in scope:</strong>
        </p>
        <ul className="list-disc pl-5">
          <li>
            <code>briven.tech</code> — the dashboard + marketing site
          </li>
          <li>
            <code>api.briven.tech</code> — the control-plane and HTTP api
          </li>
          <li>
            the open-core repository at{' '}
            <Link
              href="https://github.com/flndrn-dev/briven"
              className="text-[var(--color-text-link)] underline-offset-2 hover:underline"
            >
              github.com/flndrn-dev/briven
            </Link>{' '}
            and the published <code>@briven/*</code> npm packages
          </li>
        </ul>
        <p>
          <strong>out of scope</strong> (a non-exhaustive list — please use judgement):
        </p>
        <ul className="list-disc pl-5">
          <li>findings that require physical access to a user&apos;s device, or a compromised device / browser</li>
          <li>social engineering, phishing, or attacks against briven staff or infrastructure providers</li>
          <li>volumetric denial-of-service (DoS/DDoS) and brute-force / rate-limit testing against production</li>
          <li>missing security headers or best-practice nits with no demonstrated exploit</li>
          <li>reports from automated scanners with no validated, reproducible impact</li>
          <li>
            issues in third-party services we depend on (Polar, Cloudflare, Mittera, the hosting
            provider) — report those to the vendor; tell us if it affects briven users
          </li>
          <li>vulnerabilities in your own self-hosted deployment caused by your own configuration</li>
        </ul>
      </Section>

      <Section title="supported versions">
        <p>
          the hosted platform at <code>briven.tech</code> always runs the latest build — there is
          only ever one production version, and security fixes ship to it directly. you can
          confirm the live build sha in the dashboard footer or via{' '}
          <code>GET https://api.briven.tech/info</code>.
        </p>
        <p>
          for self-hosters, security fixes land on the <code>main</code> branch of the open-core
          repo and in the latest published <code>@briven/*</code> packages. we support the latest
          release line only — keep your deployment current to receive fixes. older pinned versions
          do not receive backported patches.
        </p>
      </Section>

      <Section title="related">
        <p>
          see also the{' '}
          <Link
            href="/sla"
            className="text-[var(--color-text-link)] underline-offset-2 hover:underline"
          >
            service level agreement
          </Link>{' '}
          for uptime commitments and the{' '}
          <Link
            href="/support"
            className="text-[var(--color-text-link)] underline-offset-2 hover:underline"
          >
            support
          </Link>{' '}
          page for non-security help.
        </p>
      </Section>

      <p className="mt-12 font-mono text-xs text-[var(--color-text-subtle)]">
        flndrn Limited, Limassol, Cyprus · thank you for helping keep briven and its users safe.
      </p>
    </DocsShell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10 flex flex-col gap-3 font-mono text-sm text-[var(--color-text-muted)]">
      <h2 className="font-mono text-lg tracking-tight text-[var(--color-text)]">{title}</h2>
      {children}
    </section>
  );
}
