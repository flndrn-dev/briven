import { DocsShell } from './shell';

export function ComingSoon({ title, phase }: { title: string; phase: string }) {
  return (
    <DocsShell>
      <h1 className="font-mono text-2xl tracking-tight">{title}</h1>
      <p className="mt-4 font-mono text-sm text-[var(--color-text-muted)]">
        Writing this page lands in {phase}. The underlying code may already work — check the
        source on GitHub or ask in the community channel while the docs catch up.
      </p>
    </DocsShell>
  );
}
