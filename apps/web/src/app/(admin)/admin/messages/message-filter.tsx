import Link from 'next/link';

const FILTERS: readonly { label: string; value: 'all' | 'plain' | 'tickets' }[] = [
  { label: 'all', value: 'all' },
  { label: 'plain', value: 'plain' },
  { label: 'tickets', value: 'tickets' },
];

export function MessageFilter({ current }: { current: 'all' | 'plain' | 'tickets' }) {
  return (
    <div className="flex flex-wrap gap-2">
      {FILTERS.map((f) => {
        const active = f.value === current;
        const href = f.value === 'all' ? '/admin/messages' : `/admin/messages?filter=${f.value}`;
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
