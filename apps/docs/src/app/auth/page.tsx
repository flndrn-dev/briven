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
          ['setup (10 min)', '#setup'],
          ['install', '#install'],
          ['get your keys', '#keys'],
          ['create the client', '#client'],
          ['react bindings', '#react'],
          ['sign-in flows', '#flows'],
          ['two-factor + backup codes', '#two-factor'],
          ['testing tokens', '#testing-tokens'],
          ['email sender domain', '#sender-domain'],
          ['verify users with tokens', '#verify-tokens'],
          ['security', '#security'],
          ['agents', '#agents'],
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

      {/* setup --------------------------------------------------------- */}
      <section id="setup" className="mt-10 scroll-mt-20 border-t border-[var(--color-border-subtle)] pt-8">
        <h2 className="font-mono text-lg tracking-tight">setup in 10 minutes</h2>
        <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
          the shortest path from zero to a working sign-in. for a browser-only
          sign-off after this, use the plain-language checklist in the briven
          repo: <code>AUTH-GO-LIVE-CHECKLIST.md</code>.
        </p>
        <ol className="mt-3 list-inside list-decimal font-mono text-sm text-[var(--color-text-muted)] space-y-2">
          <li>
            open your project at{' '}
            <a className="underline" href="https://briven.tech">
              briven.tech
            </a>{' '}
            → <em>Auth</em> → enable auth if it is not already on.
          </li>
          <li>
            <em>Auth → API keys</em> → create a key → copy{' '}
            <code>pk_briven_auth_…</code> (browser-safe). never put a{' '}
            <code>brk_…</code> key in the browser.
          </li>
          <li>
            in your app folder, wire the project first:
            <Snippet>{`# NEW project:   briven setup my-app
# EXISTING:      briven connect p_…
briven auth scaffold
pnpm add @briven/auth`}</Snippet>
            that writes <code>middleware.ts</code>, <code>lib/auth.ts</code>, and a
            seeded <code>.env.local</code> if missing. never use{' '}
            <code>setup --project</code> to attach — that flag is gone; use{' '}
            <code>briven connect</code>.
          </li>
          <li>
            paste the public key into <code>NEXT_PUBLIC_BRIVEN_AUTH_KEY</code> (and
            the same value into <code>BRIVEN_AUTH_PUBLIC_KEY</code> for middleware).
          </li>
          <li>
            send users to the hosted page or drop in the panel:
            <Snippet>{`// hosted (fastest pilot)
window.location.assign(auth.hostedPageURL('sign-in', '/dashboard'));

// or embedded React panel
import { BrivenSignIn } from '@briven/auth/react';
// <BrivenSignIn redirectTo="/dashboard" />`}</Snippet>
          </li>
          <li>
            prove it in a real browser: sign up, sign out, sign in, refresh still
            signed in. optional: wrong-password rejection + rate limit after many
            failures (production needs redis — <code>/ready</code> must show{' '}
            <code>redis: ok</code>).
          </li>
        </ol>
        <p className="mt-3 font-mono text-xs text-[var(--color-text-subtle)]">
          starter copy: <code>examples/auth-pilot/</code> in the briven monorepo.
        </p>
      </section>

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
          email-OTP emails send out of the box from the briven fallback sender — to brand them
          as your own domain, see{' '}
          <a className="underline" href="#sender-domain">email sender domain</a>.
        </section>
      </section>

      {/* two-factor ------------------------------------------------------ */}
      <section
        id="two-factor"
        className="mt-10 scroll-mt-20 border-t border-[var(--color-border-subtle)] pt-8"
      >
        <h2 className="font-mono text-lg tracking-tight">two-factor + backup codes</h2>
        <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
          when the project has two-factor enabled, password sign-in may return{' '}
          <code>twoFactorRequired</code>. complete the challenge with a TOTP app code or a
          single-use <strong>backup recovery code</strong> (for lost phones).
        </p>
        <Snippet>{`// after password sign-in returns twoFactorRequired:
const totp = await auth.twoFactor.verify('123456');
// or lost phone:
const backup = await auth.twoFactor.verifyBackupCode('XXXX-XXXX');

// enroll (show codes once after verify):
await auth.twoFactor.enable(password);
await auth.twoFactor.verify(appCode);
const { codes } = await auth.twoFactor.generateBackupCodes(password);
// save codes offline — each works once`}</Snippet>
        <p className="mt-3 font-mono text-xs text-[var(--color-text-subtle)]">
          hosted pages: after password, users land on{' '}
          <code>/auth/&lt;projectId&gt;/two-factor</code> with a toggle for backup codes.
          react: <code>TwoFactorSetup</code> + <code>TwoFactorChallenge</code> from{' '}
          <code>@briven/auth/react</code>.
        </p>
      </section>

      {/* testing tokens ------------------------------------------------- */}
      <section
        id="testing-tokens"
        className="mt-10 scroll-mt-20 border-t border-[var(--color-border-subtle)] pt-8"
      >
        <h2 className="font-mono text-lg tracking-tight">testing tokens (e2e)</h2>
        <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
          for automated tests, mint a <strong>testing token</strong> in the dashboard (or{' '}
          <code>POST /v1/projects/:id/auth/test-tokens</code> as an admin). it bypasses bot
          checks, rate limits, and MFA for a short window and is returned <em>once</em> as{' '}
          <code>briven_test_…</code>.
        </p>
        <Snippet>{`// CI / e2e (never commit the raw token)
const session = await auth.signIn.testToken(process.env.BRIVEN_AUTH_TEST_TOKEN!);
// → { ok: true, expiresAt } and a real session cookie`}</Snippet>
        <p className="mt-3 font-mono text-xs text-[var(--color-text-subtle)]">
          revoke used tokens in the dashboard. production apps for real humans should not rely
          on testing tokens.
        </p>
      </section>

      {/* sender domain -------------------------------------------------- */}
      <section
        id="sender-domain"
        className="mt-10 scroll-mt-20 border-t border-[var(--color-border-subtle)] pt-8"
      >
        <h2 className="font-mono text-lg tracking-tight">email sender domain</h2>
        <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
          every email briven auth sends for you — magic links, OTP codes, email verification,
          password resets — has a From: address. by default that is{' '}
          <code>noreply@briven.tech</code>, which works out of the box with zero setup. when you
          want those emails branded as your own product (say{' '}
          <code>noreply@yourapp.com</code>), you set a <strong>sender domain</strong>.
        </p>

        <h3 className="mt-5 font-mono text-sm">how to set it</h3>
        <ol className="mt-2 list-inside list-decimal font-mono text-sm text-[var(--color-text-muted)] space-y-1">
          <li>open your project at <a className="underline" href="https://briven.tech">briven.tech</a>.</li>
          <li>go to <em>Auth → branding</em>.</li>
          <li>
            fill in <em>sender name</em> (the display name, e.g. your product name) and{' '}
            <em>sender domain</em> — your <strong>root domain</strong>, e.g.{' '}
            <code>yourapp.com</code>. do <strong>not</strong> enter a subdomain like{' '}
            <code>auth.yourapp.com</code> unless you really send from that subdomain.
          </li>
          <li>save. that&apos;s the whole dashboard side.</li>
        </ol>

        <h3 className="mt-5 font-mono text-sm">verify the domain (2–3 DNS records)</h3>
        <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
          email worldwide runs on one rule: a domain must publicly declare who is allowed to
          send mail in its name. that declaration lives in your domain&apos;s DNS as SPF and
          DKIM records. without them, providers like Gmail and Outlook treat mail from your
          domain as forged — so no platform (briven included) can skip this step. briven hands
          you the exact records to add at your domain provider; a guided setup wizard is landing
          in the branding panel.
        </p>

        <h3 className="mt-5 font-mono text-sm">what happens before you verify</h3>
        <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
          nothing breaks — this is the important part. until your domain is verified, briven
          automatically keeps sending from the <code>noreply@briven.tech</code> fallback (with
          your sender name), so your users&apos; sign-in emails always arrive. the moment the
          domain verifies, sends switch to <code>noreply@yourdomain</code> on their own. you
          never need to time the switch or fear a broken login flow while DNS propagates.
        </p>

        <section className="mt-5 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 font-mono text-xs text-[var(--color-text-muted)]">
          <strong className="text-[var(--color-text)]">troubleshooting:</strong> sign-in emails
          arriving from <code>noreply@briven.tech</code> even though you filled in a sender
          domain? that means the domain isn&apos;t verified yet — finish adding the DNS records
          and allow up to an hour for DNS to propagate. emails not arriving at all? check spam
          first, then <em>Auth → usage</em> for delivery status.
        </section>
      </section>

      {/* verify tokens -------------------------------------------------- */}
      <section
        id="verify-tokens"
        className="mt-10 scroll-mt-20 border-t border-[var(--color-border-subtle)] pt-8"
      >
        <h2 className="font-mono text-lg tracking-tight">verify users with tokens (JWT + JWKS)</h2>
        <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
          <code>getSession()</code> asks the briven auth service every time. when your setup has
          its own backend — or several apps sharing one sign-in — you often just need a fast
          local answer to &quot;is this user signed in?&quot; without a network round-trip per
          request. for that, briven auth issues <strong>verifiable tokens</strong>: short-lived
          signed JWTs your own code can check against the project&apos;s public keys.
        </p>

        <h3 className="mt-5 font-mono text-sm">the two endpoints</h3>
        <ul className="mt-2 list-inside list-disc font-mono text-sm text-[var(--color-text-muted)] space-y-2">
          <li>
            <code>GET /v1/auth-tenant/token</code> — requires a signed-in session (the browser
            cookie). returns <code>{`{ token: "<JWT>" }`}</code>, a short-lived signed JWT for
            the current user.
          </li>
          <li>
            <code>GET /v1/auth-tenant/jwks</code> — public, no auth. returns the project&apos;s
            JSON Web Key Set, so your code can verify JWTs locally without calling briven.
          </li>
        </ul>
        <p className="mt-3 font-mono text-xs text-[var(--color-text-subtle)]">
          both live under <code>https://api.briven.tech</code> and carry your{' '}
          <code>x-briven-project-id</code> header like every auth request.
        </p>

        <h3 className="mt-5 font-mono text-sm">verify a token</h3>
        <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
          any standard JWT library that understands remote JWKS works — shown here with{' '}
          <code>jose</code>:
        </p>
        <Snippet>{`// in the signed-in browser: mint a token, hand it to your backend
const res = await fetch('https://api.briven.tech/v1/auth-tenant/token', {
  headers: {
    'x-briven-project-id': 'p_01HZ...',
    authorization: 'Bearer pk_briven_auth_...', // the browser-safe key
  },
  credentials: 'include', // sends the session cookie
});
const { token } = await res.json();

// on YOUR server: verify locally — no call to briven per request
import { createRemoteJWKSet, jwtVerify } from 'jose';

const jwks = createRemoteJWKSet(
  new URL('https://api.briven.tech/v1/auth-tenant/jwks'),
  { headers: { 'x-briven-project-id': 'p_01HZ...' } },
);

const { payload } = await jwtVerify(token, jwks);
// payload.sub is the signed-in user's id`}</Snippet>

        <section className="mt-5 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 font-mono text-xs text-[var(--color-text-muted)]">
          <strong className="text-[var(--color-text)]">keys and rotation:</strong> signing keys
          are <em>per-project</em> — a token from one project never verifies in another. key
          rotation is handled through the JWKS endpoint: when briven rotates a key, the new one
          appears in the key set, so refetch the JWKS whenever verification hits an unknown key
          id (libraries like <code>jose</code> do this for you). tokens are short-lived by
          design — refetch <code>/token</code> on expiry rather than storing one long-term.
        </section>
      </section>

      {/* security ------------------------------------------------------ */}
      <section id="security" className="mt-10 scroll-mt-20 border-t border-[var(--color-border-subtle)] pt-8">
        <h2 className="font-mono text-lg tracking-tight">security</h2>
        <ul className="mt-3 list-inside list-disc font-mono text-sm text-[var(--color-text-muted)] space-y-2">
          <li>
            the <code>pk_briven_auth_</code> key is browser-safe: it identifies the tenant and
            unlocks the end-user sign-in surface only. your server <code>brk_*</code> keys are
            not — keep them server-side. <code>read</code> scope keys cannot POST mutating
            auth-tenant routes.
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
          <li>
            password policy (length / character rules / max age / force reset) and rate limits
            are per-project. production should show <code>redis: ok</code> on{' '}
            <code>/ready</code> so limits share across servers.
          </li>
          <li>
            new device emails use a hashed browser fingerprint (no raw IPs). SSO redirects after
            SAML/OIDC only allow listed app origins.
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

      {/* agents -------------------------------------------------------- */}
      <section id="agents" className="mt-10 scroll-mt-20 border-t border-[var(--color-border-subtle)] pt-8">
        <h2 className="font-mono text-lg tracking-tight">for AI agents</h2>
        <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
          when an agent wires auth, it should follow the <code>briven-auth</code>{' '}
          skill (not invent OAuth). trusted order: link project →{' '}
          <code>briven auth scaffold</code> → install <code>@briven/auth</code> →
          human pastes <code>pk_briven_auth_…</code> → hosted page or{' '}
          <code>BrivenSignIn</code> → human runs the go-live checklist.
        </p>
        <ul className="mt-3 list-inside list-disc font-mono text-sm text-[var(--color-text-muted)] space-y-2">
          <li>
            MCP helpers are <strong>read-only</strong> today:{' '}
            <code>auth_config_get</code>, <code>sender_domain_status</code>,{' '}
            <code>auth_docs_ask</code>. they explain; they do not mint keys or
            write provider secrets.
          </li>
          <li>
            never put secrets in git or chat. never use <code>brk_</code> in{' '}
            <code>NEXT_PUBLIC_*</code>.
          </li>
          <li>
            sessions are cookies — prefer <code>getSession()</code> /{' '}
            <code>useSession()</code>, not home-rolled localStorage tokens.
          </li>
          <li>
            for e2e, use testing tokens (<code>auth.signIn.testToken</code>), not real MFA
            bypass hacks. for lost-phone recovery, implement backup codes (see{' '}
            <a className="underline" href="#two-factor">
              two-factor
            </a>
            ).
          </li>
          <li>
            framework hooks: react <code>useUserMetadata</code> / <code>useUserEmails</code>;
            vue + svelte have matching helpers. pilot: <code>examples/auth-pilot/</code>.
          </li>
        </ul>
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
