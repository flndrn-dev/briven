import Image from 'next/image';
import Link from 'next/link';

import { SignInForm } from './sign-in-form';

export const metadata = {
  title: 'sign in',
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; sent?: string }>;
}) {
  const params = await searchParams;
  const next = params.next ?? '/dashboard';
  const sent = params.sent === '1';

  return (
    <main className="relative flex min-h-dvh items-center justify-center bg-[var(--color-bg)] px-6 text-[var(--color-text)]">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-10 flex items-center gap-3" aria-label="briven home">
          <Image src="/icon.svg" alt="" width={28} height={28} priority />
          <span className="font-mono text-sm">briven</span>
        </Link>

        <h1 className="font-mono text-2xl tracking-tight">sign in</h1>
        <p className="mt-1 font-mono text-sm text-[var(--color-text-muted)]">
          {sent ? 'check your inbox for the magic link.' : 'we send a one-time link to your email.'}
        </p>

        <div className="mt-8">
          <SignInForm next={next} disabled={sent} />
        </div>

        <p className="mt-10 font-mono text-xs text-[var(--color-text-subtle)]">
          by signing in you agree to the{' '}
          <Link href="/legal/terms" className="underline underline-offset-2 hover:text-[var(--color-text)]">
            terms
          </Link>{' '}
          and{' '}
          <Link href="/legal/privacy" className="underline underline-offset-2 hover:text-[var(--color-text)]">
            privacy
          </Link>{' '}
          policy.
        </p>
      </div>
    </main>
  );
}
