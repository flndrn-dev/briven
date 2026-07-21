export function AuthBlankPanel({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <section
      className="rounded-md border p-6"
      style={{
        borderColor: 'var(--auth-accent-border, var(--color-border))',
        background: 'var(--color-surface-raised)',
      }}
    >
      <h2 className="font-mono text-sm text-[var(--color-text)]">{title}</h2>
      <p className="mt-2 max-w-xl font-mono text-xs leading-relaxed text-[var(--color-text-muted)]">
        {body}
      </p>
      <p
        className="mt-4 font-mono text-[10px] uppercase tracking-widest"
        style={{ color: 'var(--auth-accent, #e6b800)' }}
      >
        coming with Auth v2
      </p>
    </section>
  );
}
