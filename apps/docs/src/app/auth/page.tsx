import { PmTabs } from '../../components/pm-tabs';
import { DocsShell } from '../../components/shell';
import { pmInstall } from '../../lib/pm';

export const metadata = { title: 'auth' };

const INSTALL = pmInstall('@briven/auth');

export default function AuthPage() {
  return (
    <DocsShell>
      <h1 className="font-mono text-2xl tracking-tight">auth</h1>
      <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
        <code>@briven/auth</code> is a drop-in sign-in client for your briven project. one
        package gives you email + password, magic links, email OTP, passkeys (WebAuthn), and
        OAuth social login — plus React hooks and a prebuilt <code>&lt;BrivenSignIn /&gt;</code>{' '}
        panel. the SDK
        talks to the hosted briven auth service; you never run an auth server yourself.
      </p>

      <nav className="mt-6 flex flex-wrap gap-2 font-mono text-xs">
        {[
          ['install', '#install'],
          ['get your keys', '#keys'],
          ['create the client', '#client'],
          ['react bindings', '#react'],
          ['sign-in flows', '#flows'],
          ['security', '#security'],
        ].map(([label, href]) => (
          <a
            key={href}
            href={href}
            className="rounded-md border border-[var(--color-border)] px-3 py-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            {label}
          </a>
        ))}
      </nav>

      {/* install ------------------------------------------------------- */}
      <section id="install" className="mt-10 scroll-mt-20 border-t border-[var(--color-border-subtle)] pt-8">
        <h2 className="font-mono text-lg tracking-tight">install</h2>
        <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
          published to public npm — see{' '}
          <a
            className="underline"
            href="https://www.npmjs.com/package/@briven/auth"
          >
            npm
          </a>{' '}
          for the current version.
        </p>
        <div className="mt-3">
          <PmTabs commands={INSTALL} />
        </div>
        <p className="mt-3 font-mono text-xs text-[var(--color-text-subtle)]">
          subpaths: <code>@briven/auth</code> (the vanilla client, zero React deps),{' '}
          <code>@briven/auth/react</code> (hooks + the <code>&lt;BrivenSignIn /&gt;</code>{' '}
          component), and <code>@briven/auth/server</code> (Next.js App Router helpers).
        </p>
      </section>

      {/* keys ---------------------------------------------------------- */}
      <section id="keys" className="mt-10 scroll-mt-20 border-t border-[var(--color-border-subtle)] pt-8">
        <h2 className="font-mono text-lg tracking-tight">get your keys</h2>
        <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
          you need two things from the dashboard: your <strong>project id</strong> (looks like{' '}
          <code>p_01HZ…</code>) and a <strong>public auth key</strong> (looks like{' '}
          <code>pk_briven_auth_…</code>).
        </p>
        <ol className="mt-3 list-inside list-decimal font-mono text-sm text-[var(--color-text-muted)] space-y-1">
          <li>open your project at <a className="underline" href="https://briven.tech">briven.tech</a>.</li>
          <li>go to <em>Auth → API keys</em>.</li>
          <li>click <em>create key</em>, give it a name, set the scope to <code>read-write</code>.</li>
          <li>copy the <code>pk_briven_auth_…</code> value — it is shown once.</li>
        </ol>

        <section className="mt-5 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 font-mono text-xs text-[var(--color-text-muted)]">
          <strong className="text-[var(--color-text)]">which key is which:</strong> the{' '}
          <code>pk_briven_auth_</code> key is <em>browser-safe</em>. it identifies your tenant
          and unlocks the end-user sign-in surface only — it can&apos;t read or write your data.
          ship it to the browser freely. your server <code>brk_*</code> keys are{' '}
          <strong>not</strong> browser-safe; never put one in client code.
        </section>
      </section>

      {/* client -------------------------------------------------------- */}
      <section id="client" className="mt-10 scroll-mt-20 border-t border-[var(--color-border-subtle)] pt-8">
        <h2 className="font-mono text-lg tracking-tight">create the client</h2>
        <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
          <code>createBrivenAuth</code> returns a stateless client. all auth state lives in the
          browser cookie set by the service on a successful sign-in, so re-creating the client
          across renders is safe.
        </p>
        <Snippet>{`// lib/auth.ts
import { createBrivenAuth } from '@briven/auth';

export const auth = createBrivenAuth({
  projectId: 'p_01HZ...',
  publicKey: process.env.NEXT_PUBLIC_BRIVEN_AUTH_KEY!, // 'pk_briven_auth_...'
});`}</Snippet>
        <p className="mt-3 font-mono text-xs text-[var(--color-text-subtle)]">
          <span className="text-[var(--color-text)]">options: </span>
          <code>projectId</code> and <code>publicKey</code> are required.{' '}
          <code>apiOrigin</code> defaults to <code>https://api.briven.tech</code> (override it
          only for self-hosted or local dev). <code>authUrl</code> defaults to{' '}
          <code>https://&lt;projectId&gt;.auth.briven.tech</code> and backs the OAuth redirect.
        </p>
        <p className="mt-3 font-mono text-xs text-[var(--color-text-subtle)]">
          the client exposes <code>signIn</code>, <code>signUp.email</code>,{' '}
          <code>signOut()</code>, <code>getSession()</code>, and <code>getUser()</code>.
        </p>
      </section>

      {/* react --------------------------------------------------------- */}
      <section id="react" className="mt-10 scroll-mt-20 border-t border-[var(--color-border-subtle)] pt-8">
        <h2 className="font-mono text-lg tracking-tight">react bindings</h2>
        <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
          import from <code>@briven/auth/react</code>. wrap your app in the provider, then read
          state with the hooks or drop in the prebuilt panel. works in any React 19 environment
          — no hard Next.js dependency.
        </p>

        <h3 className="mt-5 font-mono text-sm">provider</h3>
        <Snippet>{`// app/providers.tsx
'use client';
import { BrivenAuthProvider } from '@briven/auth/react';
import { auth } from '../lib/auth';

export function Providers({ children }: { children: React.ReactNode }) {
  return <BrivenAuthProvider value={auth}>{children}</BrivenAuthProvider>;
}`}</Snippet>

        <h3 className="mt-5 font-mono text-sm">hooks</h3>
        <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
          <code>useSession()</code> returns <code>{`{ session, isLoading, refresh }`}</code>;{' '}
          <code>useUser()</code> returns <code>{`{ user, isLoading, refresh }`}</code>. both
          fetch once on mount — call <code>refresh()</code> after a sign-in or sign-out to
          re-read.
        </p>
        <Snippet>{`'use client';
import { useSession, useUser } from '@briven/auth/react';

export function AccountBadge() {
  const { session, isLoading } = useSession();
  const { user } = useUser();

  if (isLoading) return <span>…</span>;
  if (!session?.authenticated) return <a href="/sign-in">sign in</a>;
  return <span>signed in</span>; // don't render user.email into the UI — see security
}`}</Snippet>

        <h3 className="mt-5 font-mono text-sm">prebuilt panel</h3>
        <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
          <code>&lt;BrivenSignIn /&gt;</code> renders email + password, magic link, and your
          chosen OAuth buttons in one panel. it carries no icon library and no css framework —
          your app&apos;s styles apply via <code>className</code> and the element classes.
        </p>
        <Snippet>{`'use client';
import { BrivenSignIn } from '@briven/auth/react';

export function SignIn() {
  return (
    <BrivenSignIn
      providers={['google', 'github', 'konnos']}
      showEmailPassword
      showMagicLink
      redirectTo="/dashboard"
      onSuccess={({ userId }) => console.log('signed in', userId)}
      className="my-signin"
    />
  );
}`}</Snippet>
        <p className="mt-3 font-mono text-xs text-[var(--color-text-subtle)]">
          <span className="text-[var(--color-text)]">props: </span>
          <code>providers</code> (OAuth buttons to show — empty array hides the section),{' '}
          <code>showEmailPassword</code> (default true), <code>showMagicLink</code> (default
          true), <code>redirectTo</code>, <code>onSuccess</code>, and <code>className</code>.
        </p>
      </section>

      {/* flows --------------------------------------------------------- */}
      <section id="flows" className="mt-10 scroll-mt-20 border-t border-[var(--color-border-subtle)] pt-8">
        <h2 className="font-mono text-lg tracking-tight">sign-in flows</h2>
        <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
          if you want your own UI, call the client methods directly. every async method returns
          a tagged result — <code>{`{ ok: true, ... }`}</code> on success or{' '}
          <code>{`{ ok: false, code, message }`}</code> on failure — so you never throw on a bad
          password.
        </p>

        <h3 className="mt-5 font-mono text-sm">email + password</h3>
        <Snippet>{`// sign up, then sign in — both return { ok, userId, sessionExpiresAt }
await auth.signUp.email({ email, password, name: 'Jane' });

const result = await auth.signIn.email({ email, password });
if (result.ok) {
  // result.userId, result.sessionExpiresAt
} else {
  // result.code: 'invalid_credentials' | 'unverified_email' | 'rate_limited' | ...
  console.error(result.message);
}`}</Snippet>

        <h3 className="mt-5 font-mono text-sm">magic link</h3>
        <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
          a passwordless flow of its own — <strong>not</strong> an OAuth provider. it emails the
          user a one-click sign-in link.
        </p>
        <Snippet>{`const res = await auth.signIn.magicLink({
  email,
  redirectTo: '/dashboard', // where the link lands after verify
});
// res.ok === true means the email was sent`}</Snippet>

        <h3 className="mt-5 font-mono text-sm">email OTP</h3>
        <Snippet>{`// 1. send the code
await auth.signIn.otpRequest({ email });

// 2. verify the 6-digit code the user typed
const result = await auth.signIn.otpVerify({ email, otp: '123456' });
if (result.ok) { /* result.userId */ }`}</Snippet>

        <h3 className="mt-5 font-mono text-sm">OAuth social</h3>
        <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
          <code>social()</code> is synchronous — it builds the start URL and hands it back. you
          redirect the browser to it. provider is one of{' '}
          <code>&apos;google&apos;</code>, <code>&apos;github&apos;</code>,{' '}
          <code>&apos;discord&apos;</code>, <code>&apos;microsoft&apos;</code>, or{' '}
          <code>&apos;konnos&apos;</code>.
        </p>
        <Snippet>{`const { redirectUrl } = auth.signIn.social({
  provider: 'google',
  redirectTo: '/dashboard',
});
window.location.assign(redirectUrl);`}</Snippet>

        <h3 className="mt-5 font-mono text-sm">passkeys (WebAuthn)</h3>
        <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
          passwordless sign-in backed by the device&apos;s platform authenticator (Touch ID, Face
          ID, Windows Hello, a hardware key). two ceremonies, both wrapped for you so you never
          touch the raw <code>navigator.credentials</code> calls:
        </p>
        <Snippet>{`// REGISTER — adds a passkey to the *currently signed-in* user.
// call this from an account-settings screen, after a normal sign-in.
const reg = await auth.passkey.register();
if (reg.ok) { /* passkey saved on this device */ }

// SIGN IN — no password, no email field needed.
const result = await auth.passkey.signIn();
if (result.ok) {
  // result.userId, result.sessionExpiresAt
} else {
  // result.code: 'not_enabled' | 'cancelled' | 'unsupported' | ...
  console.error(result.message);
}`}</Snippet>
        <p className="mt-2 font-mono text-xs text-[var(--color-text-subtle)]">
          passkeys are <strong>per-tenant</strong>: the project owner enables them under{' '}
          <em>Auth → providers</em> (the <code>passkey</code> provider) and a passkey registered in
          your project only works in your project. one caveat to know:{' '}
          <code>auth.passkey.register()</code> needs an active session, and the credential is bound
          to the <strong>rpID</strong> — which is the web origin (host) your app runs on. a passkey
          registered on <code>app.example.com</code> can&apos;t be used from a different host, so
          pin your production origin before you ask users to enrol. WebAuthn also requires a secure
          context (https, or <code>localhost</code> in dev).
        </p>

        <section className="mt-5 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 font-mono text-xs text-[var(--color-text-muted)]">
          <strong className="text-[var(--color-text)]">before these work in production:</strong>{' '}
          social login (google / github / discord / microsoft / konnos) needs the project owner
          to set that provider&apos;s client id <em>and</em> secret under <em>Auth → providers</em>
          in the dashboard — until both are set, the provider stays disabled. magic-link and
          email-OTP delivery need the platform email / SMTP to be configured. with neither
          configured, only email + password works.
        </section>
      </section>

      {/* security ------------------------------------------------------ */}
      <section id="security" className="mt-10 scroll-mt-20 border-t border-[var(--color-border-subtle)] pt-8">
        <h2 className="font-mono text-lg tracking-tight">security</h2>
        <ul className="mt-3 list-inside list-disc font-mono text-sm text-[var(--color-text-muted)] space-y-2">
          <li>
            the <code>pk_briven_auth_</code> key is browser-safe: it identifies the tenant and
            unlocks the end-user sign-in surface only. your server <code>brk_*</code> keys are
            not — keep them server-side.
          </li>
          <li>
            never log or display an end-user&apos;s email or IP. the <code>User</code> object
            carries <code>email</code> for the account holder — don&apos;t echo it into a list
            view, a log line, or an analytics event.
          </li>
          <li>
            sessions live in an http cookie the service sets on sign-in; the SDK sends requests
            with <code>credentials: &apos;include&apos;</code> so the browser stores and returns
            it. you don&apos;t handle tokens yourself.
          </li>
        </ul>

        <section className="mt-5 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 font-mono text-xs text-[var(--color-text-muted)]">
          <strong className="text-[var(--color-text)]">wire protocol (you don&apos;t write this):</strong>{' '}
          every request carries <code>x-briven-project-id: &lt;projectId&gt;</code> and{' '}
          <code>authorization: Bearer &lt;publicKey&gt;</code> to{' '}
          <code>https://api.briven.tech/v1/auth-tenant/*</code>. the service resolves your
          tenant from the header and routes the request. the SDK adds these headers for you.
        </section>
      </section>

      <h2 className="mt-12 font-mono text-lg">what to read next</h2>
      <ul className="mt-3 flex flex-col gap-2 font-mono text-sm">
        <NextLink
          href="/sdks"
          title="client sdks"
          body="the data clients — @briven/react, svelte, vue — for reactive queries and mutations"
        />
        <NextLink
          href="/api-keys"
          title="api keys"
          body="key types, scopes, and rotation across the dashboard"
        />
        <NextLink
          href="/quickstart"
          title="quickstart"
          body="from nothing to a live project in five minutes"
        />
      </ul>
    </DocsShell>
  );
}

function Snippet({ children }: { children: string }) {
  return (
    <pre className="mt-2 overflow-x-auto rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-code-bg)] p-3 font-mono text-xs text-[var(--color-code-text)]">
      <code>{children}</code>
    </pre>
  );
}

function NextLink({ href, title, body }: { href: string; title: string; body: string }) {
  return (
    <li>
      <a
        href={href}
        className="block rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 transition hover:border-[var(--color-border)]"
      >
        <p className="font-mono text-[var(--color-text)]">{title}</p>
        <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">{body}</p>
      </a>
    </li>
  );
}
