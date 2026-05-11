import Image from 'next/image';
import Link from 'next/link';

import { SignInForm } from './sign-in-form';

export const metadata = {
  title: 'sign in',
};

function describeError(code: string | undefined): string | null {
  if (!code) return null;
  // Map the most common Better Auth + provider error codes to human copy.
  // Default fallback: surface the code verbatim so an operator chasing
  // a regression can grep it.
  if (code.startsWith('oauth_')) {
    const provider = code.slice('oauth_'.length);
    return `the ${provider} sign-in didn't complete. this is usually a temporary issue — try again. if it keeps failing, check that your ${provider} app's authorized redirect URI matches https://api.briven.tech/v1/auth/${provider === 'konnos' ? 'oauth2/callback/konnos' : `callback/${provider}`}.`;
  }
  if (code === 'state_mismatch') {
    return 'the sign-in didn\'t complete because your browser blocked a cookie. try again in a private window, or check your browser settings.';
  }
  return `sign-in failed (${code}). try again or use a different method.`;
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const next = params.next ?? '/dashboard';
  const errorMessage = describeError(params.error);

  // Public api origin — surfaced via NEXT_PUBLIC_BRIVEN_API_ORIGIN so the
  // signin form posts directly to it instead of going through Next.js's
  // /api/* rewrite (which proxy edges sometimes mangle).
  const apiOrigin = process.env.NEXT_PUBLIC_BRIVEN_API_ORIGIN ?? '';
  // Each provider flag mirrors a server-side env: when the credentials
  // aren't configured, hide the button so users don't trigger a 500.
  const providers = {
    google: process.env.NEXT_PUBLIC_BRIVEN_HAS_GOOGLE_OAUTH === 'true',
    github: process.env.NEXT_PUBLIC_BRIVEN_HAS_GITHUB_OAUTH === 'true',
    konnos: process.env.NEXT_PUBLIC_BRIVEN_HAS_KONNOS_OAUTH === 'true',
    discord: process.env.NEXT_PUBLIC_BRIVEN_HAS_DISCORD_OAUTH === 'true',
  };

  return (
    <main className="relative flex min-h-dvh items-center justify-center bg-[var(--color-bg)] px-6 text-[var(--color-text)]">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-10 flex items-center gap-3" aria-label="briven home">
          <Image src="/icon.svg" alt="" width={28} height={28} priority />
          <span className="font-mono text-sm">briven</span>
        </Link>

        <h1 className="font-mono text-2xl tracking-tight">sign in</h1>

        {errorMessage ? (
          <div
            role="alert"
            className="mt-6 rounded-md border border-[var(--color-text-error)] bg-red-500/5 p-4 font-mono text-xs text-red-300"
          >
            {errorMessage}
          </div>
        ) : null}

        <div className="mt-8">
          <SignInForm next={next} apiOrigin={apiOrigin} providers={providers} />
        </div>

        <p className="mt-10 font-mono text-xs text-[var(--color-text-subtle)]">
          by signing in you agree to the{' '}
          <Link
            href="/terms"
            className="underline underline-offset-2 hover:text-[var(--color-text)]"
          >
            terms
          </Link>{' '}
          and{' '}
          <Link
            href="/privacy"
            className="underline underline-offset-2 hover:text-[var(--color-text)]"
          >
            privacy
          </Link>{' '}
          policy.
        </p>
      </div>
    </main>
  );
}
