import { DocsShell } from '../../components/shell';
import { CHANGELOG_ENTRIES, type ChangelogEntry, type ChangelogTag } from './entries';

export const metadata = {
  title: 'changelog',
};

type Entry = ChangelogEntry;
type Tag = ChangelogTag;


const TAG_STYLE: Record<Tag, string> = {
  feat: 'bg-[var(--color-primary)] text-[var(--color-text-inverse)]',
  fix: 'border border-[var(--color-border)] text-[var(--color-text-muted)]',
  security: 'bg-[var(--color-text-error)] text-[var(--color-text-inverse)]',
  docs: 'border border-[var(--color-border)] text-[var(--color-text-muted)]',
  infra: 'border border-[var(--color-border)] text-[var(--color-text-muted)]',
  chore: 'border border-[var(--color-border)] text-[var(--color-text-subtle)]',
};

export default function ChangelogPage() {
  const grouped = groupByMonth(CHANGELOG_ENTRIES);
  return (
    <DocsShell>
      <div className="flex items-start justify-between gap-4">
        <h1 className="font-mono text-2xl tracking-tight">changelog</h1>
        <a
          href="/changelog/feed.xml"
          className="rounded-md border border-[var(--color-border)] px-3 py-1 font-mono text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        >
          rss feed
        </a>
      </div>
      <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
        what landed, in reverse chronological order. one entry per shipped change worth
        knowing about — security, features, infrastructure, fixes.
      </p>

      <div className="mt-6 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 font-mono text-xs text-[var(--color-text-muted)]">
        briven is in dogfood-first development through 2026. external signups open with the
        public beta in <strong>oct 2026</strong>; everything before that is internal validation
        on j&apos;s own products.
      </div>

      <div className="mt-12 flex flex-col gap-12">
        {grouped.map(({ month, entries }) => (
          <section key={month}>
            <h2 className="font-mono text-xl tracking-tight">{month}</h2>
            <ul className="mt-6 flex flex-col gap-6">
              {entries.map((entry) => (
                <li key={`${entry.date}-${entry.title}`} className="flex flex-col gap-2">
                  <div className="flex items-center gap-3">
                    <time className="font-mono text-xs text-[var(--color-text-subtle)]">
                      {entry.date}
                    </time>
                    <div className="flex gap-1">
                      {entry.tags.map((tag) => (
                        <span
                          key={tag}
                          className={`rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide ${TAG_STYLE[tag]}`}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                  <p className="font-mono text-sm">{entry.title}</p>
                  <p className="font-mono text-sm text-[var(--color-text-muted)]">{entry.body}</p>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </DocsShell>
  );
}

function groupByMonth(entries: readonly Entry[]): { month: string; entries: Entry[] }[] {
  const buckets = new Map<string, Entry[]>();
  for (const entry of entries) {
    const month = entry.date.slice(0, 7); // yyyy-mm
    const list = buckets.get(month) ?? [];
    list.push(entry);
    buckets.set(month, list);
  }
  // Sort entries within each bucket newest-first, then sort buckets newest-first.
  for (const list of buckets.values()) {
    list.sort((a, b) => b.date.localeCompare(a.date));
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([month, list]) => ({ month: formatMonth(month), entries: list }));
}

function formatMonth(yyyymm: string): string {
  const [yearStr, monthStr] = yyyymm.split('-');
  const year = Number(yearStr);
  const monthIdx = Number(monthStr) - 1;
  const monthNames = [
    'january',
    'february',
    'march',
    'april',
    'may',
    'june',
    'july',
    'august',
    'september',
    'october',
    'november',
    'december',
  ];
  return `${monthNames[monthIdx] ?? yyyymm} ${year}`;
}
