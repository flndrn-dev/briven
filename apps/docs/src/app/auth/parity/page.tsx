import { DocsShell } from '../../../components/shell';

export const metadata = { title: 'auth · SuperTokens parity walk' };

type Row = { area: string; status: 'Y' | 'P' | 'N' | 'N/A'; note: string };

const ROWS: Row[] = [
  { area: 'Email password', status: 'Y', note: 'FDI signin/signup' },
  { area: 'Passwordless email OTP / magic link', status: 'Y', note: 'Phase 3 live' },
  { area: 'Passwordless SMS', status: 'P', note: 'UI ready; Twilio human prove' },
  { area: 'Third-party social', status: 'Y', note: 'Full catalog when secrets set' },
  { area: 'WebAuthn / passkeys', status: 'Y', note: 'Phase 5' },
  { area: 'TOTP MFA', status: 'Y', note: 'Phase 5' },
  { area: 'Session recipe', status: 'Y', note: 'Doltgres sessions' },
  { area: 'User roles', status: 'Y', note: 'Phase 6' },
  { area: 'Multitenancy (project→tenant)', status: 'Y', note: 'Path A map' },
  { area: 'Enterprise SAML SSO (SP)', status: 'Y', note: 'briven-engine native' },
  { area: 'Enterprise OIDC SSO (SP)', status: 'Y', note: 'briven-engine native' },
  { area: 'OAuth2/OIDC provider (IdP)', status: 'Y', note: 'authorize/token/userinfo/… + live proof script' },
  { area: 'M2M client credentials', status: 'Y', note: 'Keys → machine clients' },
  { area: 'User migration / import', status: 'Y', note: 'plaintext + bcrypt/argon2 hash import' },
  { area: 'Dashboard (operator)', status: 'Y', note: 'yellow Auth tabs' },
  { area: 'Security audit trail', status: 'Y', note: 'Security diary' },
  { area: 'Captcha', status: 'P', note: 'Turnstile when configured' },
  { area: 'Branding', status: 'Y', note: 'logo/color/sender/footer + email HTML' },
  { area: 'AI authentication', status: 'Y', note: 'AI agent tokens brai_…' },
  { area: 'Framework integration pack', status: 'Y', note: 'docs/auth/frameworks' },
  { area: 'SuperTokens Core Docker', status: 'N/A', note: 'Doltgres path; Core removed' },
  { area: 'Full 492-URL line-by-line', status: 'P', note: 'covered by this parity matrix + plan; open rows above' },
  { area: 'Claim 100% ST surface', status: 'P', note: 'SMS live prove still open' },
];

export default function AuthParityPage() {
  return (
    <DocsShell>
      <h1 className="font-mono text-2xl tracking-tight">SuperTokens parity walk</h1>
      <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
        SuperTokens docs are a <strong className="text-[var(--color-text)]">checklist</strong>, not
        a dependency. Status: <strong className="text-[var(--color-text)]">Y</strong> done ·{' '}
        <strong className="text-[var(--color-text)]">P</strong> partial ·{' '}
        <strong className="text-[var(--color-text)]">N</strong> not yet ·{' '}
        <strong className="text-[var(--color-text)]">N/A</strong> won&apos;t do.
      </p>

      <div className="mt-8 overflow-x-auto">
        <table className="w-full min-w-[32rem] border-collapse font-mono text-xs">
          <thead>
            <tr className="border-b border-[var(--color-border-subtle)] text-left text-[var(--color-text-muted)]">
              <th className="py-2 pr-3 font-medium">Area</th>
              <th className="py-2 pr-3 font-medium">Status</th>
              <th className="py-2 font-medium">Notes</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr
                key={r.area}
                className="border-b border-[var(--color-border-subtle)] text-[var(--color-text)]"
              >
                <td className="py-2 pr-3 align-top">{r.area}</td>
                <td className="py-2 pr-3 align-top font-semibold">{r.status}</td>
                <td className="py-2 align-top text-[var(--color-text-muted)]">{r.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-8 font-mono text-xs text-[var(--color-text-muted)]">
        Related:{' '}
        <a className="underline" href="/auth/frameworks">
          framework packs
        </a>{' '}
        · IdP proof script <code className="text-[var(--color-text)]">scripts/idp-live-proof.ts</code>
      </p>
    </DocsShell>
  );
}
