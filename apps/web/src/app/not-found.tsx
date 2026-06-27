import Image from 'next/image';
import Link from 'next/link';

export const metadata = { title: 'not found · briven' };

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-6 px-6 py-16 font-mono text-sm">
      <Link href="/" className="flex items-center gap-2" aria-label="briven home">
        <Image src="/icon.svg" alt="" width={28} height={28} priority />
        <span>briven</span>
      </Link>

      <div>
        <h1 className="text-2xl tracking-tight">404 · not found</h1>
        <p className="mt-2 text-[var(--color-text-muted)]">
          the page you tried to reach doesn&apos;t exist. try one of these:
        </p>
      </div>

      <ul className="flex flex-col gap-2">
        {[
          { href: '/', label: 'home' },
          { href: '/signin', label: 'sign in / get started' },
          { href: 'https://docs.briven.tech', label: 'docs' },
          { href: 'https://docs.briven.tech/quickstart', label: 'quickstart' },
          { href: 'https://docs.briven.tech/status', label: 'status' },
        ].map((p) => (
          <li key={p.href}>
            <Link
              href={p.href}
              className="block rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-3 hover:border-[var(--color-border)]"
            >
              {p.label} →
            </Link>
          </li>
        ))}
      </ul>

      <footer className="mt-auto pt-8 font-mono text-[10px] text-[var(--color-text-subtle)]">
        built with <span className="text-[#e8344a]">♥</span> in Flanders · flndrn
      </footer>
    </main>
  );
}
