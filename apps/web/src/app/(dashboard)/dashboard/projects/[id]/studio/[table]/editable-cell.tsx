'use client';

import { useState } from 'react';

interface Props {
  /** Server-action that drives the actual PATCH; closes over projectId + table. */
  action: (input: {
    primaryKey: Array<{ column: string; value: string | number }>;
    column: string;
    value: unknown;
  }) => Promise<void>;
  /**
   * Row-identity payload. Length-1 for single-PK tables, length-N for
   * composite. The api enforces that the column set matches the table's
   * actual primary key — no partial-PK shortcuts.
   */
  primaryKey: Array<{ column: string; value: string | number }>;
  column: string;
  initialValue: unknown;
  /** True when the column is the primary key — read-only. */
  readOnly?: boolean;
}

/**
 * Inline-editable cell. Click to edit, blur or Enter to commit, Esc to
 * cancel. Optimistically renders the new value while the action runs;
 * reverts to `initialValue` if the server rejects.
 */
export function EditableCell({
  action,
  primaryKey,
  column,
  initialValue,
  readOnly,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(stringify(initialValue));
  const [committed, setCommitted] = useState(initialValue);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (readOnly) {
    return (
      <span title="primary key (read-only)" className="text-[var(--color-text-subtle)]">
        {stringify(committed)}
      </span>
    );
  }

  async function commit(): Promise<void> {
    setEditing(false);
    if (draft === stringify(committed)) return;
    setPending(true);
    setError(null);
    const previous = committed;
    const next = parseDraft(draft, committed);
    setCommitted(next);
    try {
      await action({ primaryKey, column, value: next });
    } catch (err) {
      setCommitted(previous);
      setDraft(stringify(previous));
      setError(err instanceof Error ? err.message : 'update failed');
    } finally {
      setPending(false);
    }
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void commit();
          else if (e.key === 'Escape') {
            setDraft(stringify(committed));
            setEditing(false);
          }
        }}
        disabled={pending}
        className="w-full rounded-sm border border-[var(--color-primary)] bg-[var(--color-surface-raised)] px-1 py-0.5 font-mono text-xs outline-none"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title={error ?? 'click to edit'}
      className={`block w-full text-left ${
        error ? 'text-[var(--color-text-error)]' : pending ? 'opacity-60' : ''
      }`}
    >
      {stringify(committed)}
    </button>
  );
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

/**
 * Parse the user's typed string back into the right shape based on the
 * existing committed value's type. Empty string → null. Numbers and
 * booleans round-trip; objects parse as JSON. If the JSON parse fails
 * for an object-type cell, fall back to the literal string — the server
 * will reject it if the column is jsonb-typed and the string isn't valid
 * json, surfacing the error to the user.
 */
function parseDraft(draft: string, committed: unknown): unknown {
  if (draft === '') return null;
  if (typeof committed === 'number') {
    const n = Number(draft);
    return Number.isFinite(n) ? n : draft;
  }
  if (typeof committed === 'boolean') {
    if (draft === 'true') return true;
    if (draft === 'false') return false;
    return draft;
  }
  if (committed && typeof committed === 'object') {
    try {
      return JSON.parse(draft);
    } catch {
      return draft;
    }
  }
  return draft;
}
