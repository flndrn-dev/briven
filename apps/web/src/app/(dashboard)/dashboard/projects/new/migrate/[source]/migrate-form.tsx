'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

import { notifyDashboardChange } from '../../../../../../../components/live-refresh';

type SubmitResult =
  | { ok: true; redirectTo: string }
  | { ok: false; error: string };

interface Props {
  sourceSlug: string;
  sourceName: string;
  urlLabel: string;
  urlPlaceholder: string;
  urlHelp: string;
  defaultEmail: string;
  submit: (input: {
    source: string;
    sourceUrl: string;
    sourceNotes: string;
    estimatedTables: string;
    estimatedRows: string;
    estimatedFunctions: string;
    urgency: 'direct' | 'this_week' | 'this_month' | 'this_quarter' | 'exploring';
    contactEmail: string;
  }) => Promise<SubmitResult>;
}

const URGENCY_OPTIONS = [
  { value: 'direct', label: 'Direct · as soon as possible' },
  { value: 'this_week', label: 'This week · time-sensitive' },
  { value: 'this_month', label: 'This month' },
  { value: 'this_quarter', label: 'This quarter' },
  { value: 'exploring', label: 'Just exploring · no rush' },
] as const;

type Urgency = (typeof URGENCY_OPTIONS)[number]['value'];

export function MigrateForm({
  sourceSlug,
  sourceName,
  urlLabel,
  urlPlaceholder,
  urlHelp,
  defaultEmail,
  submit,
}: Props) {
  const router = useRouter();
  const [sourceUrl, setSourceUrl] = useState('');
  const [estimatedTables, setEstimatedTables] = useState('');
  const [estimatedRows, setEstimatedRows] = useState('');
  const [estimatedFunctions, setEstimatedFunctions] = useState('');
  const [sourceNotes, setSourceNotes] = useState('');
  const [urgency, setUrgency] = useState<Urgency>('this_month');
  const [contactEmail, setContactEmail] = useState(defaultEmail);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const result = await submit({
          source: sourceSlug,
          sourceUrl: sourceUrl.trim(),
          sourceNotes: sourceNotes.trim(),
          estimatedTables: estimatedTables.trim(),
          estimatedRows: estimatedRows.trim(),
          estimatedFunctions: estimatedFunctions.trim(),
          urgency,
          contactEmail: contactEmail.trim(),
        });
        if (result.ok) {
          notifyDashboardChange();
          router.push(result.redirectTo);
        } else {
          setError(result.error);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'submission failed');
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <fieldset className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-5">
        <legend className="px-2 text-sm font-semibold text-[var(--color-text)]">
          When do you need this done?
        </legend>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
          We size the migration window from this — pick the closest match. You can change it any
          time before we start.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {URGENCY_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className={`flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 text-sm transition ${
                urgency === opt.value
                  ? opt.value === 'direct'
                    ? 'border-[var(--color-error)] bg-[var(--color-error)]/10 text-[var(--color-text)]'
                    : 'border-[var(--color-primary)] bg-[var(--color-primary-subtle)] text-[var(--color-text)]'
                  : 'border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] text-[var(--color-text-muted)] hover:border-[var(--color-border)]'
              }`}
            >
              <input
                type="radio"
                name="urgency"
                value={opt.value}
                checked={urgency === opt.value}
                onChange={() => setUrgency(opt.value)}
                className="size-4 accent-[var(--color-primary)]"
              />
              <span>{opt.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-5">
        <h3 className="text-sm font-semibold text-[var(--color-text)]">{sourceName} source</h3>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
          The deployment we&apos;ll read from. We never write back — your existing source stays
          untouched until you press the cutover button.
        </p>
        <label className="mt-4 flex flex-col gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
            {urlLabel}{' '}
            <span className="text-[var(--color-text-subtle)] normal-case">(optional)</span>
          </span>
          <input
            type="text"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.currentTarget.value)}
            maxLength={2000}
            placeholder={urlPlaceholder}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
          />
          <span className="text-xs text-[var(--color-text-subtle)]">{urlHelp}</span>
        </label>
      </div>

      <fieldset className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-5">
        <legend className="px-2 text-sm font-semibold text-[var(--color-text)]">
          Rough scale
        </legend>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
          Estimates are fine — we use these to plan the window, not to bill you.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <LabeledInput
            label="Tables / collections"
            type="number"
            placeholder="12"
            value={estimatedTables}
            onChange={setEstimatedTables}
          />
          <LabeledInput
            label="Total rows / documents"
            type="number"
            placeholder="500000"
            value={estimatedRows}
            onChange={setEstimatedRows}
          />
          <LabeledInput
            label="Functions / handlers"
            type="number"
            placeholder="18"
            value={estimatedFunctions}
            onChange={setEstimatedFunctions}
          />
        </div>
      </fieldset>

      <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-5">
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
            Anything else we should know
          </span>
          <textarea
            value={sourceNotes}
            onChange={(e) => setSourceNotes(e.currentTarget.value)}
            rows={5}
            maxLength={8000}
            placeholder="We use clerk for auth, ~50 daily active users, want to cut over before next launch on the 21st."
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
          />
          <span className="text-xs text-[var(--color-text-subtle)]">
            Auth provider, special requirements, deadlines — anything that helps us scope.
          </span>
        </label>
      </div>

      <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-5">
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
            Contact email
          </span>
          <input
            type="email"
            required
            value={contactEmail}
            onChange={(e) => setContactEmail(e.currentTarget.value)}
            maxLength={320}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
          />
          <span className="text-xs text-[var(--color-text-subtle)]">
            We&apos;ll reach out within one business day to walk you through next steps.
          </span>
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs">
          {error ? (
            <span role="alert" className="text-red-400">
              {error}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/dashboard/projects/new"
            className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-[var(--color-text-inverse)] transition hover:bg-[var(--color-primary-hover)] disabled:opacity-40"
          >
            {pending ? 'Submitting…' : 'Request migration · free during beta'}
          </button>
        </div>
      </div>
    </form>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  type,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
        {label}
      </span>
      <input
        type={type ?? 'text'}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        placeholder={placeholder}
        min={type === 'number' ? 0 : undefined}
        max={type === 'number' ? 10_000_000 : undefined}
        className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
      />
    </label>
  );
}
