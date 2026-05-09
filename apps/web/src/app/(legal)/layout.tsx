import Image from 'next/image';
import Link from 'next/link';

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative min-h-dvh bg-[var(--color-bg)] text-[var(--color-text)]">
      <header className="border-b border-[var(--color-border-subtle)]">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-6 py-6">
          <Link href="/" className="flex items-center gap-3" aria-label="briven home">
            <Image src="/icon.svg" alt="" width={28} height={28} />
            <span className="font-mono text-sm">briven</span>
          </Link>
          <nav className="flex gap-6 font-mono text-xs text-[var(--color-text-muted)]">
            <Link href="/trust" className="hover:text-[var(--color-text)]">
              trust
            </Link>
            <Link href="/privacy" className="hover:text-[var(--color-text)]">
              privacy
            </Link>
            <Link href="/terms" className="hover:text-[var(--color-text)]">
              terms
            </Link>
          </nav>
        </div>
      </header>

      <article className="prose prose-invert mx-auto max-w-3xl px-6 py-12 font-sans leading-[1.7] text-[var(--color-text-muted)]">
        {children}
      </article>
    </main>
  );
}
