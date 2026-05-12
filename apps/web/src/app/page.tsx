import Image from 'next/image';
import Link from 'next/link';

import { LandingUserMenu } from '../components/landing-user-menu';
import { getSessionUser } from '../lib/session';
import { PricingSection } from './pricing-section';

export default async function HomePage() {
  const user = await getSessionUser().catch(() => null);
  return (
    <main className="relative min-h-dvh overflow-hidden bg-[var(--color-bg)] text-[var(--color-text)]">
      <BackgroundGrid />

      <header className="relative z-50 mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
        <Link href="/" className="flex items-center gap-2" aria-label="briven home">
          <Image src="/icon.svg" alt="" width={40} height={40} priority className="opacity-95" />
          <span className="font-mono tracking-tight text-[var(--color-text)] text-[var(--text-small)]">
            briven
          </span>
          <span className="hidden font-mono text-[var(--color-text-subtle)] text-[var(--text-xs)] sm:inline">
            · tech
          </span>
        </Link>

        <nav className="flex items-center gap-6 font-mono text-[var(--text-small)]">
          <Link
            href="#pricing"
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            pricing
          </Link>
          <Link
            href="https://docs.briven.tech"
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            docs
          </Link>
          <Link
            href="https://code.konnos.org/flndrn/briven"
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            konnos
          </Link>
          {user ? (
            <LandingUserMenu
              user={{
                name: user.name,
                email: user.email,
                image: user.image,
                legalName: user.legalName,
              }}
            />
          ) : (
            <Link
              href="/signin"
              className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              sign in
            </Link>
          )}
        </nav>
      </header>

      <section className="relative z-10 mx-auto w-full max-w-6xl px-6 pb-16 pt-20 sm:pt-28">
        <div className="flex max-w-3xl flex-col gap-6">
          <LiveBadge />
          <h1 className="font-sans font-medium leading-[1.05] tracking-[-0.03em] text-[var(--color-text)] text-[var(--text-display-3)] sm:text-[var(--text-display-2)]">
            the postgres backend
            <br />
            you actually own.
          </h1>
          <p className="max-w-2xl leading-[1.6] text-[var(--color-text-muted)] text-[var(--text-body)]">
            reactive queries, typed schema, one-command deploys — on vanilla postgres. worldwide
            multi-region hosting. self-hostable. export your whole project with one command, any
            day.
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Link
              href="/signin"
              className="inline-flex h-12 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-primary)] px-6 font-sans font-medium text-[var(--color-text-inverse)] shadow-[var(--shadow-sm)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease-briven)] hover:bg-[var(--color-primary-hover)] active:bg-[var(--color-primary-pressed)]"
            >
              get started
            </Link>
            <Link
              href="https://docs.briven.tech"
              className="inline-flex h-12 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-transparent px-6 font-sans font-medium text-[var(--color-text)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease-briven)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-raised)]"
            >
              read the docs
            </Link>
          </div>

          <InstallBlock />
        </div>
      </section>

      <section className="relative z-10 mx-auto grid w-full max-w-6xl grid-cols-1 gap-px border-t border-[var(--color-border-subtle)] bg-[var(--color-border-subtle)] sm:grid-cols-2 lg:grid-cols-4">
        <Pillar
          title="convex ergonomics"
          body="cli or dashboard — build your schema by clicking through forms or by deploying schema.ts. typescript end-to-end, aha moment in under 60 seconds."
        />
        <Pillar
          title="postgres underneath"
          body="every table is a real table. every query is real sql. pg_dump is your escape hatch."
        />
        <Pillar
          title="worldwide, owned, portable"
          body="multi-region from day one. agpl-licensed core. export everything, any time."
        />
        <Pillar
          title="boring reliability"
          body="daily backups, point-in-time recovery, monthly restore drills — from day one."
        />
      </section>

      <section className="relative z-10 mx-auto w-full max-w-6xl px-6 py-16">
        <h2 className="font-sans font-medium tracking-[-0.02em] text-[var(--color-text)] text-[var(--text-h2)]">
          two paths to the same Postgres schema
        </h2>
        <div className="mt-6 grid grid-cols-1 gap-px overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border-subtle)] bg-[var(--color-border-subtle)] md:grid-cols-2">
          <div className="flex flex-col gap-3 bg-[var(--color-bg)] p-6">
            <h3 className="font-mono text-sm text-[var(--color-primary)]">cli + git</h3>
            <p className="font-sans text-[var(--text-body)] text-[var(--color-text-muted)]">
              for engineers who want their schema in version control. write{' '}
              <code>briven/schema.ts</code>, <code>briven deploy</code>, the cli diffs against the
              live schema and applies the migration transactionally. functions live in{' '}
              <code>briven/functions/</code> as plain TypeScript files.
            </p>
            <Link
              href="https://docs.briven.tech/quickstart"
              className="self-start font-mono text-xs text-[var(--color-text-link)] underline-offset-2 hover:underline"
            >
              quickstart →
            </Link>
          </div>
          <div className="flex flex-col gap-3 bg-[var(--color-bg)] p-6">
            <h3 className="font-mono text-sm text-[var(--color-primary)]">dashboard / studio</h3>
            <p className="font-sans text-[var(--text-body)] text-[var(--color-text-muted)]">
              for prototyping, one-off changes, and anyone who&apos;d rather click than write
              TypeScript. studio gives you the full DDL surface (create / rename / drop
              table, column, index, FK), an inline SQL editor scoped to your schema, and a
              data browser with edit-in-place. <em>copy as schema.ts</em> graduates a
              click-built database back to git.
            </p>
            <Link
              href="https://briven.tech/signin"
              className="self-start font-mono text-xs text-[var(--color-text-link)] underline-offset-2 hover:underline"
            >
              open the dashboard →
            </Link>
          </div>
        </div>
        <p className="mt-4 font-mono text-xs text-[var(--color-text-subtle)]">
          both write to the same Postgres schema. mix freely.
        </p>
      </section>

      <PricingSection />

      <footer className="relative z-10 mx-auto flex w-full max-w-6xl flex-col items-start justify-between gap-4 border-t border-[var(--color-border-subtle)] px-6 py-6 font-mono text-[10px] text-[var(--color-text-subtle)] sm:flex-row sm:items-center">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
          <div className="flex items-center gap-1">
            <Image src="/icon.svg" alt="" width={22} height={22} className="opacity-70" />
            <span>
              © {new Date().getFullYear()} flndrn Limited · agpl-3.0 core · mit cli
            </span>
          </div>
          <span className="hidden sm:inline">·</span>
          <span>
            built with <span className="text-[#e8344a]">♥</span> in Flanders
          </span>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/trust" className="hover:text-[var(--color-text-muted)]">
            trust
          </Link>
          <Link href="/privacy" className="hover:text-[var(--color-text-muted)]">
            privacy
          </Link>
          <Link href="/terms" className="hover:text-[var(--color-text-muted)]">
            terms
          </Link>
          <Link href="/subprocessors" className="hover:text-[var(--color-text-muted)]">
            subprocessors
          </Link>
          <Link
            href="https://docs.briven.tech/quickstart"
            className="hover:text-[var(--color-text-muted)]"
          >
            quickstart
          </Link>
          <Link
            href="https://docs.briven.tech/examples"
            className="hover:text-[var(--color-text-muted)]"
          >
            examples
          </Link>
          <Link
            href="https://docs.briven.tech/api"
            className="hover:text-[var(--color-text-muted)]"
          >
            api
          </Link>
          <Link
            href="https://docs.briven.tech/changelog"
            className="hover:text-[var(--color-text-muted)]"
          >
            changelog
          </Link>
          <Link href="https://docs.briven.tech" className="hover:text-[var(--color-text-muted)]">
            docs
          </Link>
        </div>
      </footer>
    </main>
  );
}

function LiveBadge() {
  return (
    <div className="inline-flex w-fit items-center gap-2 rounded-[var(--radius-full)] border border-[var(--color-border-primary)] bg-[var(--color-primary-subtle)] px-3 py-1 font-mono text-[var(--color-text)] text-[var(--text-xs)]">
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-primary)] opacity-60" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--color-primary)]" />
      </span>
      phase 0 · foundations · private alpha
    </div>
  );
}

function InstallBlock() {
  return (
    <div className="mt-8 w-full max-w-xl overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-code-bg)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] px-4 py-2 font-mono text-[var(--color-text-subtle)] text-[var(--text-xs)]">
        <span>terminal</span>
        <span>zsh</span>
      </div>
      <pre className="overflow-x-auto p-4 font-mono leading-[1.7] text-[var(--color-code-text)] text-[var(--text-small)]">
        <span className="text-[var(--color-text-subtle)]">{'# scaffold a new project'}</span>
        {'\n'}
        <span className="text-[var(--color-primary)]">npx</span>
        {' briven init'}
        {'\n\n'}
        <span className="text-[var(--color-text-subtle)]">{'# deploy to briven.tech'}</span>
        {'\n'}
        <span className="text-[var(--color-primary)]">npx</span>
        {' briven deploy'}
      </pre>
    </div>
  );
}

function Pillar({ title, body }: { title: string; body: string }) {
  return (
    <article className="flex flex-col gap-2 bg-[var(--color-bg)] p-6">
      <h3 className="font-mono uppercase tracking-[0.12em] text-[var(--color-primary)] text-[var(--text-xs)]">
        {title}
      </h3>
      <p className="leading-[1.6] text-[var(--color-text-muted)] text-[var(--text-small)]">
        {body}
      </p>
    </article>
  );
}

function BackgroundGrid() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-0 opacity-[0.35]"
      style={{
        backgroundImage:
          'linear-gradient(to right, var(--color-border-subtle) 1px, transparent 1px), linear-gradient(to bottom, var(--color-border-subtle) 1px, transparent 1px)',
        backgroundSize: '48px 48px',
        maskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%, black 30%, transparent 75%)',
        WebkitMaskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%, black 30%, transparent 75%)',
      }}
    />
  );
}
