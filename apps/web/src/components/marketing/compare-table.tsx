interface CompareRow {
  feature: string;
  briven: string;
  other: string;
  note?: string;
}

export function CompareTable({ rows, otherName }: { rows: CompareRow[]; otherName: string }) {
  return (
    <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-subtle)]">
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_1.2fr_1.2fr]">
        <div className="border-b border-[var(--color-border-subtle)] px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)] sm:border-r">
          feature
        </div>
        <div className="border-b border-[var(--color-border-subtle)] px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-[var(--color-primary)] sm:border-r">
          briven
        </div>
        <div className="border-b border-[var(--color-border-subtle)] px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
          {otherName}
        </div>

        {rows.map((row, i) => (
          <Row key={row.feature} row={row} isLast={i === rows.length - 1} />
        ))}
      </div>
    </div>
  );
}

function Row({ row, isLast }: { row: CompareRow; isLast: boolean }) {
  const border = isLast ? '' : 'border-b border-[var(--color-border-subtle)]';
  return (
    <>
      <div
        className={`${border} bg-[var(--color-surface)] px-4 py-4 font-mono text-xs text-[var(--color-text)] sm:border-r`}
      >
        {row.feature}
        {row.note ? (
          <p className="mt-1 font-mono text-[10px] text-[var(--color-text-subtle)]">{row.note}</p>
        ) : null}
      </div>
      <div
        className={`${border} px-4 py-4 font-mono text-xs leading-[1.6] text-[var(--color-text)] sm:border-r`}
      >
        {row.briven}
      </div>
      <div
        className={`${border} px-4 py-4 font-mono text-xs leading-[1.6] text-[var(--color-text-muted)]`}
      >
        {row.other}
      </div>
    </>
  );
}
