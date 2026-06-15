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

// Friendly, non-coder labels for the raw Postgres types (value stays the
// real type; only the displayed text changes).
const TYPE_LABELS: Record<ColType, string> = {
  text: 'text',
  integer: 'whole number',
  bigint: 'whole number (large)',
  boolean: 'yes / no',
  timestamptz: 'date & time',
  jsonb: 'json data',
  uuid: 'unique id',
  numeric: 'decimal number',
};

const FK_ON_DELETE = ['noAction', 'cascade', 'setNull', 'restrict'] as const;
type FkOnDelete = (typeof FK_ON_DELETE)[number];

interface ColumnDraft {
  id: string;
  name: string;
  type: ColType;
  notNull: boolean;
  primaryKey: boolean;
  defaultExpr: string;
  /** "table.column" or empty. */
  references: string;
  onDelete: FkOnDelete;
}

function newDraft(name = '', primaryKey = false): ColumnDraft {
  return {
    id: Math.random().toString(36).slice(2),
    name,
    type: 'text',
    notNull: primaryKey,
    primaryKey,
    defaultExpr: '',
    references: '',
    onDelete: 'noAction',
  };
}

export function NewTableForm({
  projectId,
  existingTables = [],
}: {
  projectId: string;
  existingTables?: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tableName, setTableName] = useState('');
  const [columns, setColumns] = useState<ColumnDraft[]>([
    newDraft('id', true),
    { ...newDraft('createdAt'), type: 'timestamptz', notNull: true, defaultExpr: 'now()' },
  ]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setCol(id: string, patch: Partial<ColumnDraft>) {
    setColumns((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const payload = {
        tableName,
        columns: columns.map((c) => {
          const [refTable, refCol] = c.references.split('.');
          return {
            name: c.name,
            type: c.type,
            notNull: c.notNull,
            primaryKey: c.primaryKey,
            defaultExpr: c.defaultExpr.trim() === '' ? null : c.defaultExpr,
            references:
              refTable && refCol
                ? { table: refTable, column: refCol, onDelete: c.onDelete }
                : null,
          };
        }),
      };
      const res = await fetch(`/api/v1/projects/${projectId}/studio/tables`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string; code?: string };
        throw new Error(body.message ?? body.code ?? `create failed: ${res.status}`);
      }
      setOpen(false);
      setTableName('');
      setColumns([
        newDraft('id', true),
        { ...newDraft('createdAt'), type: 'timestamptz', notNull: true, defaultExpr: 'now()' },
      ]);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'create failed');
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start rounded-md bg-[var(--color-primary)] px-4 py-2 font-mono text-sm font-medium text-[var(--color-text-inverse)] transition hover:bg-[var(--color-primary-hover)]"
      >
        + new table
      </button>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-4 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4"
    >
      <div className="flex items-center justify-between">
        <h3 className="font-mono text-sm">new table</h3>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="font-mono text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        >
          cancel
        </button>
      </div>

      <label className="flex flex-col gap-1">
        <span className="font-mono text-xs text-[var(--color-text-muted)]">table name</span>
        <input
          type="text"
          required
          pattern="[A-Za-z_][A-Za-z0-9_]*"
          maxLength={63}
          value={tableName}
          onChange={(e) => setTableName(e.target.value)}
          placeholder="notes"
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--color-primary)]"
        />
      </label>

      <div className="flex flex-col gap-2">
        <span className="font-mono text-xs text-[var(--color-text-muted)]">columns</span>
        {columns.map((c) => (
          <div key={c.id} className="flex flex-col gap-1 rounded-md bg-[var(--color-bg)] p-2">
            <div className="grid grid-cols-[1.5fr_1fr_auto_auto_1.2fr_auto] items-center gap-2">
              <input
                type="text"
                required
                pattern="[A-Za-z_][A-Za-z0-9_]*"
                maxLength={63}
                value={c.name}
                onChange={(e) => setCol(c.id, { name: e.target.value })}
                placeholder="column"
                className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 font-mono text-xs outline-none focus:border-[var(--color-primary)]"
              />
              <select
                value={c.type}
                onChange={(e) => setCol(c.id, { type: e.target.value as ColType })}
                className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 font-mono text-xs outline-none focus:border-[var(--color-primary)]"
              >
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
              <label
                title="Primary key — the unique identifier for each row (e.g. the 'id')"
                className="flex items-center gap-1 font-mono text-[10px] text-[var(--color-text-muted)]"
              >
                <input
                  type="checkbox"
                  checked={c.primaryKey}
                  onChange={(e) =>
                    setCol(c.id, {
                      primaryKey: e.target.checked,
                      notNull: e.target.checked ? true : c.notNull,
                    })
                  }
                />
                key
              </label>
              <label
                title="Required — this field can't be left empty"
                className="flex items-center gap-1 font-mono text-[10px] text-[var(--color-text-muted)]"
              >
                <input
                  type="checkbox"
                  checked={c.notNull}
                  disabled={c.primaryKey}
                  onChange={(e) => setCol(c.id, { notNull: e.target.checked })}
                />
                required
              </label>
              <input
                type="text"
                value={c.defaultExpr}
                onChange={(e) => setCol(c.id, { defaultExpr: e.target.value })}
                placeholder="default (e.g. now())"
                className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 font-mono text-xs outline-none focus:border-[var(--color-primary)]"
              />
              <button
                type="button"
                onClick={() => setColumns((prev) => prev.filter((x) => x.id !== c.id))}
                disabled={columns.length === 1}
                className="rounded-md border border-[var(--color-border)] px-2 py-1 font-mono text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text-error)] disabled:opacity-30"
                aria-label={`remove ${c.name}`}
              >
                ×
              </button>
            </div>
            <div className="grid grid-cols-[auto_1.5fr_1fr] items-center gap-2 pl-2">
              <span className="font-mono text-[10px] text-[var(--color-text-subtle)]">
                references
              </span>
              <input
                type="text"
                value={c.references}
                onChange={(e) => setCol(c.id, { references: e.target.value })}
                placeholder={
                  existingTables.length > 0
                    ? `e.g. ${existingTables[0]}.id (optional FK)`
                    : 'tableName.columnName (optional FK)'
                }
                className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 font-mono text-[10px] outline-none focus:border-[var(--color-primary)]"
                list={`existing-tables-${c.id}`}
              />
              <select
                value={c.onDelete}
                disabled={!c.references}
                onChange={(e) => setCol(c.id, { onDelete: e.target.value as FkOnDelete })}
                className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 font-mono text-[10px] outline-none focus:border-[var(--color-primary)] disabled:opacity-30"
                aria-label="on delete"
              >
                {FK_ON_DELETE.map((d) => (
                  <option key={d} value={d}>
                    on delete {d}
                  </option>
                ))}
              </select>
              <datalist id={`existing-tables-${c.id}`}>
                {existingTables.map((t) => (
                  <option key={t} value={`${t}.id`} />
                ))}
              </datalist>
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setColumns((prev) => [...prev, newDraft()])}
          className="self-start rounded-md border border-dashed border-[var(--color-border)] px-3 py-1 font-mono text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        >
          + add column
        </button>
      </div>

      {error ? (
        <p className="rounded-md bg-red-400/10 px-3 py-2 font-mono text-xs text-red-400">{error}</p>
      ) : null}

      <div className="flex justify-end gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-[var(--color-primary)] px-4 py-2 font-mono text-sm font-medium text-[var(--color-text-inverse)] transition hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
        >
          {pending ? 'creating…' : 'create table'}
        </button>
      </div>
    </form>
  );
}
