import { fetchAuthDashboard } from '../lib/auth-api';

export const metadata = { title: 'Auth · security' };
export const dynamic = 'force-dynamic';

export default async function SecurityPage() {
  const dash = await fetchAuthDashboard();

  return (
    <section className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="font-sans text-2xl font-medium tracking-[-0.02em] text-[var(--color-text)]">
          security
        </h1>
        <p className="font-mono text-xs text-[var(--color-text-muted)]">
          extra protection for sign-in
        </p>
      </header>

      <ul className="grid gap-3 sm:grid-cols-2">
        <Card
          title="authenticator app"
          body="users can turn on time-based codes (TOTP) for a second step at sign-in."
        />
        <Card
          title="passkeys"
          body="device biometrics and security keys for passwordless sign-in."
        />
        <Card
          title="SMS codes"
          body={
            dash.ok && dash.data.methods.passwordlessSms
              ? 'phone one-time codes are available.'
              : 'phone one-time codes can be enabled for a project.'
          }
        />
        <Card
          title="sessions"
          body={
            dash.ok
              ? `${dash.data.counts.sessions} active session${dash.data.counts.sessions === 1 ? '' : 's'} right now.`
              : 'see who is signed in from the sessions tab.'
          }
        />
      </ul>
    </section>
  );
}

function Card({ title, body }: { title: string; body: string }) {
  return (
    <li className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4">
      <p className="font-mono text-sm text-[var(--color-text)]">{title}</p>
      <p className="mt-2 font-mono text-xs leading-relaxed text-[var(--color-text-muted)]">
        {body}
      </p>
    </li>
  );
}
