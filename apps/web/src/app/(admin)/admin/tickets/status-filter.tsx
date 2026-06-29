import Link from 'next/link';

const FILTERS: readonly { label: string; value: string | undefined }[] = [
  { label: 'all', value: undefined },
  { label: 'no response', value: 'no_response' },
  { label: 'in review', value: 'in_review' },
  { label: 'replied', value: 'replied' },
  { label: 'closed', value: 'closed' },
];

export function StatusFilter({ current }: { current: string | undefined }) {
  return (
    <div className="flex flex-wrap gap-2">
      {FILTERS.map((f) => {
        const active = f.value === current;
        const href = f.value ? `/admin/tickets?status=${f.value}` : '/admin/tickets';
        return (
          <Link
            key={f.label}
            href={href}
            className={`rounded-full border px-3 py-1 font-mono text-xs transition-colors ${
              active
                ? 'border-[var(--color-primary)] bg-[var(--color-primary-subtle)] text-[var(--color-primary)]'
                : 'border-[var(--color-border-subtle)] text-[var(--color-text-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)]'
            }`}
          >
            {f.label}
          </Link>
        );
      })}
    </div>
  );
}
