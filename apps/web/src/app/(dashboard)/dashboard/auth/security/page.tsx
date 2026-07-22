import { fetchAuthDashboard, fetchAuthRecipes } from '../lib/auth-api';

export const metadata = { title: 'Briven Auth · security' };
export const dynamic = 'force-dynamic';

/**
 * Security — MFA / TOTP / passkeys status (Doltgres-native engine).
 */
export default async function SecurityPage() {
  const [dash, recipes] = await Promise.all([
    fetchAuthDashboard(),
    fetchAuthRecipes(),
  ]);

  const mfa = recipes?.loaded?.includes('multifactorauth') ?? false;
  const webauthn = recipes?.loaded?.includes('webauthn') ?? false;

  return (
    <section className="flex flex-col gap-4">
      <p
        className="font-mono text-[10px] uppercase tracking-widest"
        style={{ color: 'var(--auth-accent, #e6b800)' }}
      >
        briven-engine · security · doltgres
      </p>
      <h2 className="font-mono text-sm text-[var(--color-text)]">
        MFA, passkeys, delivery
      </h2>
      <p className="max-w-xl font-mono text-xs text-[var(--color-text-muted)]">
        Authenticator-app codes (TOTP) and passkeys are stored in Doltgres tables{' '}
        <code className="text-[var(--color-text)]">be_totp_devices</code> and{' '}
        <code className="text-[var(--color-text)]">be_webauthn_credentials</code>.
      </p>

      <ul className="grid gap-2 sm:grid-cols-2">
        <Card
          title="Authenticator app (TOTP)"
          body={
            mfa
              ? 'API ready: POST /v1/auth-core/mfa/totp · verify · check'
              : 'not loaded'
          }
        />
        <Card
          title="Passkeys (WebAuthn)"
          body={
            webauthn
              ? 'API ready: /v1/auth-core/passkeys/register/* · authenticate/*'
              : 'not loaded'
          }
        />
        <Card
          title="SMS OTP"
          body={
            dash.ok && dash.data.methods.passwordlessSms
              ? 'included · passwordless on Doltgres'
              : 'passwordless path'
          }
        />
        <Card
          title="Active sessions"
          body={dash.ok ? String(dash.data.counts.sessions) : 'sign in to load'}
        />
      </ul>
    </section>
  );
}

function Card({ title, body }: { title: string; body: string }) {
  return (
    <li
      className="rounded-md border p-3 font-mono text-xs"
      style={{ borderColor: 'var(--auth-accent-border, var(--color-border))' }}
    >
      <div className="text-[var(--color-text)]">{title}</div>
      <div className="mt-1 text-[10px] text-[var(--color-text-muted)]">{body}</div>
    </li>
  );
}
