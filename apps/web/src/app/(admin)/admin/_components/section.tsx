'use client';

/**
 * Command-deck page section: a lowercase mono heading with optional icon,
 * an optional right-side slot (live badges, links, actions), and generous
 * spacing between heading and content.
 */
export function Section({
  title,
  icon,
  right,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-[var(--color-text-subtle)]">
          {icon ? <span className="text-[var(--color-text-muted)]">{icon}</span> : null}
          {title}
        </h2>
        {right ? <div className="flex items-center gap-2">{right}</div> : null}
      </div>
      {children}
    </section>
  );
}
