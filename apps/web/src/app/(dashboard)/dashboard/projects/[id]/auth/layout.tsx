import type { ReactNode } from 'react';

/**
 * Option B: old project-scoped Auth UI is retired.
 * All former /auth/* tabs render the same moved notice (children ignored).
 */
export default async function AuthLayout({
  children: _children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  void _children;
  const { id } = await params;
  return <AuthMovedNotice projectId={id} />;
}

function AuthMovedNotice({ projectId }: { projectId: string }) {
  return (
    <section className="flex flex-col gap-6 py-4">
      <div className="rounded-md border border-[color-mix(in_srgb,#FFFD74_45%,var(--color-border))] bg-[var(--color-surface-raised)] p-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#FFFD74]">
          Auth moved
        </p>
        <h2 className="mt-2 font-mono text-base text-[var(--color-text)]">
          project Auth screens are closed
        </h2>
        <p className="mt-3 max-w-2xl font-mono text-xs leading-relaxed text-[var(--color-text-muted)]">
          Briven Auth is being rebuilt as its own yellow section in the main
          sidebar (not under Project/DB). Providers, users, keys, and domains
          will live there. This old path is intentionally blank.
        </p>
        <p className="mt-2 font-mono text-xs text-[var(--color-text-muted)]">
          project <code className="text-[var(--color-text)]">{projectId}</code>
        </p>
        <a
          href="/dashboard/auth"
          className="mt-5 inline-flex rounded-md px-4 py-2 font-mono text-xs font-medium text-black transition hover:opacity-90"
          style={{ background: '#FFFD74' }}
        >
          open Briven Auth →
        </a>
      </div>
    </section>
  );
}
