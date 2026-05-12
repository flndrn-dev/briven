'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

const TYPES = [
  'text',
  'integer',
  'bigint',
  'boolean',
  'timestamptz',
  'jsonb',
  'uuid',
  'numeric',
] as const;
type ColType = (typeof TYPES)[number];

const FK_ON_DELETE = ['noAction', 'cascade', 'setNull', 'restrict'] as const;
type FkOnDelete = (typeof FK_ON_DELETE)[number];

interface ColumnInfo {
  name: string;
  dataType: string;
  nullable: boolean;
  defaultExpr: string | null;
  isPrimaryKey: boolean;
  references?: { table: string; column: string } | null;
}

interface IndexInfo {
  name: string;
  columns: string[];
  unique: boolean;
  isPrimary: boolean;
}

interface Props {
  projectId: string;
  table: string;
  columns: ColumnInfo[];
  indexes: IndexInfo[];
  otherTables: string[];
}

export function SchemaPanel({ projectId, table, columns, indexes, otherTables }: Props) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<ColType>('text');
  const [notNull, setNotNull] = useState(false);
  const [defaultExpr, setDefaultExpr] = useState('');
  const [references, setReferences] = useState('');
  const [onDelete, setOnDelete] = useState<FkOnDelete>('noAction');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addColumn(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const [refTable, refCol] = references.split('.');
      const payload = {
        column: {
          name,
          type,
          notNull,
          defaultExpr: defaultExpr.trim() === '' ? null : defaultExpr,
          references:
            refTable && refCol ? { table: refTable, column: refCol, onDelete } : null,
        },
      };
      const res = await fetch(
        `/api/v1/projects/${projectId}/studio/tables/${encodeURIComponent(table)}/columns`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string; code?: string };
        throw new Error(body.message ?? body.code ?? `add column failed: ${res.status}`);
      }
      setName('');
      setType('text');
      setNotNull(false);
      setDefaultExpr('');
      setReferences('');
      setOnDelete('noAction');
      setAddOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'add failed');
    } finally {
      setPending(false);
    }
  }

  async function dropColumn(columnName: string) {
    if (
      !confirm(
        `drop column "${columnName}"? data in this column will be permanently deleted — there is no undo.`,
      )
    ) {
      return;
    }
    setError(null);
    try {
      const res = await fetch(
        `/api/v1/projects/${projectId}/studio/tables/${encodeURIComponent(
          table,
        )}/columns/${encodeURIComponent(columnName)}`,
        { method: 'DELETE' },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string; code?: string };
        throw new Error(body.message ?? body.code ?? `drop column failed: ${res.status}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'drop failed');
    }
  }

  async function createIndex(cols: string[], unique: boolean) {
    setError(null);
    try {
      const res = await fetch(
        `/api/v1/projects/${projectId}/studio/tables/${encodeURIComponent(table)}/indexes`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ columns: cols, unique }),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string; code?: string };
        throw new Error(body.message ?? body.code ?? `create index failed: ${res.status}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'create failed');
    }
  }

  async function dropIndexByName(name: string) {
    if (!confirm(`drop index "${name}"?`)) return;
    setError(null);
    try {
      const res = await fetch(
        `/api/v1/projects/${projectId}/studio/tables/${encodeURIComponent(
          table,
        )}/indexes/${encodeURIComponent(name)}`,
        { method: 'DELETE' },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string; code?: string };
        throw new Error(body.message ?? body.code ?? `drop index failed: ${res.status}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'drop failed');
    }
  }

  async function dropTable() {
    const confirmation = prompt(
      `drop table "${table}"? type the table name to confirm — this CANNOT be undone.`,
    );
    if (confirmation !== table) return;
    setError(null);
    try {
      const res = await fetch(
        `/api/v1/projects/${projectId}/studio/tables/${encodeURIComponent(table)}`,
        { method: 'DELETE' },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string; code?: string };
        throw new Error(body.message ?? body.code ?? `drop table failed: ${res.status}`);
      }
      router.push(`/dashboard/projects/${projectId}/studio`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'drop failed');
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-mono text-sm">schema</h3>
        {!addOpen ? (
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="rounded-md border border-[var(--color-border)] px-3 py-1 font-mono text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            + add column
          </button>
        ) : null}
      </div>

      {addOpen ? (
        <form onSubmit={addColumn} className="flex flex-col gap-3 rounded-md bg-[var(--color-bg)] p-3">
          <div className="grid grid-cols-[1.5fr_1fr_auto_1.2fr_auto] items-center gap-2">
            <input
              type="text"
              required
              pattern="[A-Za-z_][A-Za-z0-9_]*"
              maxLength={63}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="column name"
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 font-mono text-xs outline-none focus:border-[var(--color-primary)]"
            />
            <select
              value={type}
              onChange={(e) => setType(e.target.value as ColType)}
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 font-mono text-xs outline-none focus:border-[var(--color-primary)]"
            >
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1 font-mono text-[10px] text-[var(--color-text-muted)]">
              <input
                type="checkbox"
                checked={notNull}
                onChange={(e) => setNotNull(e.target.checked)}
              />
              not null
            </label>
            <input
              type="text"
              value={defaultExpr}
              onChange={(e) => setDefaultExpr(e.target.value)}
              placeholder="default (e.g. now())"
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 font-mono text-xs outline-none focus:border-[var(--color-primary)]"
            />
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={pending}
                className="rounded-md bg-[var(--color-primary)] px-3 py-1 font-mono text-xs text-[var(--color-text-inverse)] hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
              >
                {pending ? 'adding…' : 'add'}
              </button>
              <button
                type="button"
                onClick={() => setAddOpen(false)}
                className="font-mono text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              >
                cancel
              </button>
            </div>
          </div>
          <div className="grid grid-cols-[auto_1.5fr_1fr] items-center gap-2 pl-2">
            <span className="font-mono text-[10px] text-[var(--color-text-subtle)]">
              references
            </span>
            <input
              type="text"
              value={references}
              onChange={(e) => setReferences(e.target.value)}
              placeholder={
                otherTables.length > 0
                  ? `e.g. ${otherTables[0]}.id (optional FK)`
                  : 'tableName.columnName (optional FK)'
              }
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 font-mono text-[10px] outline-none focus:border-[var(--color-primary)]"
              list="schema-panel-other-tables"
            />
            <select
              value={onDelete}
              disabled={!references}
              onChange={(e) => setOnDelete(e.target.value as FkOnDelete)}
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 font-mono text-[10px] outline-none focus:border-[var(--color-primary)] disabled:opacity-30"
              aria-label="on delete"
            >
              {FK_ON_DELETE.map((d) => (
                <option key={d} value={d}>
                  on delete {d}
                </option>
              ))}
            </select>
            <datalist id="schema-panel-other-tables">
              {otherTables.map((t) => (
                <option key={t} value={`${t}.id`} />
              ))}
            </datalist>
          </div>
          {notNull && defaultExpr.trim() === '' && columns.length > 0 ? (
            <p className="font-mono text-[10px] text-[var(--color-text-subtle)]">
              tip: a NOT NULL column without a default fails to add when the table already
              has rows. give it a default (e.g. <code>0</code>, <code>now()</code>) or leave
              it nullable.
            </p>
          ) : null}
        </form>
      ) : null}

      <ul className="flex flex-col gap-1">
        {columns.map((c) => (
          <li
            key={c.name}
            className="flex items-center justify-between rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg)] px-3 py-2 font-mono text-xs"
          >
            <div>
              <span className={c.isPrimaryKey ? 'text-[var(--color-primary)]' : ''}>
                {c.name}
              </span>
              <span className="ml-2 text-[var(--color-text-subtle)]">
                {c.dataType}
                {c.nullable ? '' : ' · not null'}
                {c.isPrimaryKey ? ' · pk' : ''}
                {c.references
                  ? ` · → ${c.references.table}.${c.references.column}`
                  : ''}
                {c.defaultExpr ? ` · default ${c.defaultExpr}` : ''}
              </span>
            </div>
            {c.isPrimaryKey ? null : (
              <button
                type="button"
                onClick={() => dropColumn(c.name)}
                className="rounded-md border border-[var(--color-border)] px-2 py-0.5 text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text-error)]"
                aria-label={`drop column ${c.name}`}
              >
                drop
              </button>
            )}
          </li>
        ))}
      </ul>

      <IndexesSection
        columns={columns.map((c) => c.name)}
        indexes={indexes}
        onCreate={createIndex}
        onDrop={dropIndexByName}
      />

      {error ? (
        <p className="rounded-md bg-red-400/10 px-3 py-2 font-mono text-xs text-red-400">{error}</p>
      ) : null}

      <div className="border-t border-[var(--color-border-subtle)] pt-3">
        <button
          type="button"
          onClick={dropTable}
          className="rounded-md border border-red-500/40 px-3 py-1.5 font-mono text-xs text-red-400 transition hover:bg-red-500/10"
        >
          drop this table
        </button>
        <p className="mt-1 font-mono text-[10px] text-[var(--color-text-subtle)]">
          drops the table including every row. fails if another table references this one
          via foreign key.
        </p>
      </div>
    </section>
  );
}

function IndexesSection({
  columns,
  indexes,
  onCreate,
  onDrop,
}: {
  columns: string[];
  indexes: IndexInfo[];
  onCreate: (cols: string[], unique: boolean) => Promise<void>;
  onDrop: (name: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [unique, setUnique] = useState(false);
  const [pending, setPending] = useState(false);

  function toggleCol(col: string) {
    setSelected((prev) => (prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]));
  }

  async function submit() {
    if (selected.length === 0) return;
    setPending(true);
    try {
      await onCreate(selected, unique);
      setSelected([]);
      setUnique(false);
      setOpen(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t border-[var(--color-border-subtle)] pt-3">
      <div className="flex items-center justify-between">
        <h4 className="font-mono text-xs text-[var(--color-text-muted)]">indexes</h4>
        {!open ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-md border border-[var(--color-border)] px-2 py-0.5 font-mono text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            + new index
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="flex flex-col gap-2 rounded-md bg-[var(--color-bg)] p-3">
          <p className="font-mono text-[10px] text-[var(--color-text-muted)]">
            pick the columns the index covers. order matters for multi-column indexes.
          </p>
          <div className="flex flex-wrap gap-2">
            {columns.map((c) => {
              const idx = selected.indexOf(c);
              const isSelected = idx !== -1;
              return (
                <button
                  type="button"
                  key={c}
                  onClick={() => toggleCol(c)}
                  className={`rounded-md border px-2 py-0.5 font-mono text-[10px] ${
                    isSelected
                      ? 'border-[var(--color-primary)] text-[var(--color-primary)]'
                      : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                  }`}
                >
                  {isSelected ? `${idx + 1}. ${c}` : c}
                </button>
              );
            })}
          </div>
          <label className="flex items-center gap-1 font-mono text-[10px] text-[var(--color-text-muted)]">
            <input
              type="checkbox"
              checked={unique}
              onChange={(e) => setUnique(e.target.checked)}
            />
            unique
          </label>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setSelected([]);
                setUnique(false);
              }}
              className="font-mono text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={pending || selected.length === 0}
              className="rounded-md bg-[var(--color-primary)] px-3 py-1 font-mono text-[10px] text-[var(--color-text-inverse)] hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
            >
              {pending ? 'creating…' : 'create index'}
            </button>
          </div>
        </div>
      ) : null}

      <ul className="flex flex-col gap-1">
        {indexes.map((idx) => (
          <li
            key={idx.name}
            className="flex items-center justify-between rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg)] px-3 py-1.5 font-mono text-[10px]"
          >
            <div>
              <span className={idx.isPrimary ? 'text-[var(--color-primary)]' : ''}>
                {idx.name}
              </span>
              <span className="ml-2 text-[var(--color-text-subtle)]">
                ({idx.columns.join(', ')})
                {idx.unique ? ' · unique' : ''}
                {idx.isPrimary ? ' · primary' : ''}
              </span>
            </div>
            {idx.isPrimary ? null : (
              <button
                type="button"
                onClick={() => onDrop(idx.name)}
                className="rounded-md border border-[var(--color-border)] px-2 py-0.5 text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text-error)]"
              >
                drop
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
