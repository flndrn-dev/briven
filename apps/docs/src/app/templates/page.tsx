import { DocsShell } from '../../components/shell';

export const metadata = { title: 'cli templates' };

interface Template {
  name: string;
  pitch: string;
  description: string;
  schema: string;
  highlights: readonly string[];
}

const TEMPLATES: readonly Template[] = [
  {
    name: 'blank',
    pitch: 'kick the tyres',
    description:
      'one table (notes), one reactive query. the smallest valid briven project — useful when you just want to see the deploy / invoke loop work end-to-end before you commit to a real model.',
    schema: `briven/
├── schema.ts               # 1 table: notes
└── functions/
    └── listNotes.ts        # 1 reactive query`,
    highlights: ['1 table', '1 reactive query', '0 mutations'],
  },
  {
    name: 'todo-app',
    pitch: 'canonical hello-world',
    description:
      'classic todo list. 4 mutations covering create / toggle / rename / delete, 1 reactive query with a filter argument (open / done / all).',
    schema: `briven/
├── schema.ts               # 1 table: todos
└── functions/
    ├── listTodos.ts        # reactive query with ?filter=open|done|all
    ├── createTodo.ts       # mutation: validates body length, ulid id
    ├── toggleTodo.ts       # mutation: flips done + sets completedAt
    ├── renameTodo.ts       # mutation: body replace
    └── deleteTodo.ts       # mutation: hard delete by id`,
    highlights: ['1 table', '1 query (with args)', '4 mutations', 'input validation'],
  },
  {
    name: 'chat',
    pitch: 'real-time multi-room',
    description:
      'rooms + messages with a per-room reactive query. shows how to use a foreign key + leading-column index to scope realtime fan-out to one room per subscriber. ulid ids, server-side timestamps.',
    schema: `briven/
├── schema.ts               # 2 tables: rooms, messages (FK)
└── functions/
    ├── listRooms.ts        # reactive query
    ├── createRoom.ts       # mutation
    ├── listMessages.ts     # reactive query, args: { roomId }
    └── postMessage.ts      # mutation, args: { roomId, body }`,
    highlights: ['2 tables with FK', 'per-room realtime', '2 queries', '2 mutations'],
  },
  {
    name: 'convex-notes',
    pitch: 'familiar to convex users',
    description:
      'multi-user notes with per-owner reactive listing + optional tag filter — mirrors the canonical convex notes-app shape. ownership is enforced inside each mutation as an explicit guard, not via row-level policy. comes pre-wired so a convex user sees their mental model land 1:1.',
    schema: `briven/
├── schema.ts               # 1 table: notes (owner-scoped)
└── functions/
    ├── listNotes.ts        # reactive query, args: { ownerId, tag? }
    ├── createNote.ts       # mutation
    ├── updateNote.ts       # mutation with ownership guard
    └── deleteNote.ts       # mutation with ownership guard`,
    highlights: ['multi-user', 'per-owner realtime', 'ownership guards', 'tag filter'],
  },
  {
    name: 'supabase-auth-todos',
    pitch: 'familiar to supabase users',
    description:
      "auth-scoped todo list. every function reads ctx.session.userId and applies the same scoping supabase would do via row-level security — except the predicate lives in code, where you can read it and debug it. paste this to translate `auth.uid() = user_id` into briven's model.",
    schema: `briven/
├── schema.ts               # 1 table: todos (user_id-scoped)
└── functions/
    ├── myTodos.ts          # reactive query, uses ctx.session.userId
    ├── createTodo.ts       # mutation, inserts with userId
    ├── toggleTodo.ts       # mutation with ownership guard
    └── deleteTodo.ts       # mutation with ownership guard`,
    highlights: ['auth-aware', 'RLS → guards', '1 query', '3 mutations'],
  },
];

export default function TemplatesPage() {
  return (
    <DocsShell>
      <h1 className="font-mono text-2xl tracking-tight">cli templates</h1>
      <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
        every <code>briven init --template=&lt;name&gt;</code> ships inline with the cli — no
        network call, works on a fresh machine. pick one that matches your starting point;
        you can always edit the files after.
      </p>

      <pre className="mt-4 overflow-x-auto rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-code-bg)] p-3 font-mono text-xs text-[var(--color-code-text)]">
        <code>briven init my-app --template=todo-app</code>
      </pre>

      <p className="mt-2 font-mono text-xs text-[var(--color-text-subtle)]">
        pass <code>--list-templates</code> to print the available names without scaffolding.
      </p>

      {TEMPLATES.map((t) => (
        <section
          key={t.name}
          id={t.name}
          className="mt-10 scroll-mt-20 border-t border-[var(--color-border-subtle)] pt-8"
        >
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-mono text-lg tracking-tight">
              <code>{t.name}</code>
            </h2>
            <span className="font-mono text-xs text-[var(--color-text-subtle)]">{t.pitch}</span>
          </div>
          <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">{t.description}</p>
          <ul className="mt-3 flex flex-wrap gap-2 font-mono text-[10px]">
            {t.highlights.map((h) => (
              <li
                key={h}
                className="rounded-md border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-text-muted)]"
              >
                {h}
              </li>
            ))}
          </ul>
          <pre className="mt-4 overflow-x-auto rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-code-bg)] p-3 font-mono text-xs text-[var(--color-code-text)]">
            <code>{t.schema}</code>
          </pre>
          <pre className="mt-3 overflow-x-auto rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-code-bg)] p-3 font-mono text-xs text-[var(--color-code-text)]">
            <code>{`briven init my-app --template=${t.name}\ncd my-app\nbriven login --project <p_id> --key <brk_key>\nbriven deploy`}</code>
          </pre>
        </section>
      ))}
    </DocsShell>
  );
}
