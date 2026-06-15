import Link from 'next/link';

import { BackgroundGrid } from '../components/marketing/background-grid';
import { SiteFooter } from '../components/marketing/site-footer';
import { SiteHeader } from '../components/marketing/site-header';
import { getSessionUser } from '../lib/session';
import { PricingSection } from './pricing-section';

export default async function HomePage() {
  const user = await getSessionUser().catch(() => null);
  return (
    <main className="relative min-h-dvh overflow-hidden bg-[var(--color-bg)] text-[var(--color-text)]">
      <BackgroundGrid />
      <SiteHeader user={user} />

      <section className="relative z-10 mx-auto w-full max-w-6xl px-6 pb-16 pt-20 sm:pt-28">
        <div className="flex max-w-3xl flex-col gap-6">
          <LiveBadge />
          <h1 className="font-sans font-medium leading-[1.05] tracking-[-0.03em] text-[var(--color-text)] text-[var(--text-display-3)] sm:text-[var(--text-display-2)]">
            the database
            <br />
            anyone can use.
          </h1>
          <p className="max-w-2xl leading-[1.6] text-[var(--color-text-muted)] text-[var(--text-body)]">
            create and run a real database — no coding required. start from a template, edit your
            data like a spreadsheet, and undo any mistake with one click. honest pricing, no
            surprise bills. made in Flanders, independent.
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
          title="no code needed"
          body="build your database by clicking, not coding. add tables and edit rows like a spreadsheet — your first working database in under a minute."
        />
        <Pillar
          title="start from a template"
          body="pick what you want to track — contacts, inventory, bookings, tasks — and get ready-made tables with example data, instantly."
        />
        <Pillar
          title="an undo button for your data"
          body="save a snapshot before any big change, restore it in one click if something goes wrong. experiment without fear."
        />
        <Pillar
          title="honest & independent"
          body="generous limits, no surprise bills. a real Postgres database underneath. made in Flanders, self-funded — not big-tech."
        />
      </section>

      <section className="relative z-10 mx-auto w-full max-w-6xl px-6 py-16">
        <h2 className="font-sans font-medium tracking-[-0.02em] text-[var(--color-text)] text-[var(--text-h2)]">
          two paths to the same schema
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
          both write to the same database. mix freely.
        </p>
      </section>

      <section className="relative z-10 mx-auto w-full max-w-3xl px-6 py-16 text-center">
        <p className="font-mono text-xs uppercase tracking-[0.12em] text-[var(--color-primary)]">
          not a big-tech company
        </p>
        <p className="mt-4 font-sans text-[var(--text-body)] leading-[1.6] text-[var(--color-text-muted)]">
          briven isn&apos;t built by a giant with a churn dashboard and a pivot-to-ads roadmap.
          it&apos;s made with <span className="text-[#e8344a]">♥</span> in Flanders by flndrn —{' '}
          <strong className="text-[var(--color-text)]">
            100% self-funded, sustainable, and independent
          </strong>
          . no investors to appease, no rug-pulls, no acquisition fire-sale. just a tool we run
          ourselves, built to outlast the hype.
        </p>
      </section>

      <PricingSection />

      <SiteFooter />
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
      phase 4 · public beta · launching may 2026
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
