'use client';

import { useEffect, useRef, useState, useTransition, type FormEvent } from 'react';

type VatState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'valid'; name: string | null; address: string | null }
  | { status: 'invalid'; reason: string }
  | { status: 'unverifiable'; reason: string };

interface ProfileInitial {
  name: string;
  legalName: string;
  companyName: string;
  vatId: string;
  addressLine1: string;
  addressLine2: string;
  addressCity: string;
  addressPostalCode: string;
  addressRegion: string;
  addressCountry: string;
}

interface Props {
  initial: ProfileInitial;
  save: (patch: Record<string, string | null>) => Promise<void>;
}

// Minimal EU + surrounding country list. Extend as we onboard beyond the EU/EEA.
const COUNTRIES: Array<{ code: string; name: string }> = [
  { code: 'AT', name: 'Austria' },
  { code: 'BE', name: 'Belgium' },
  { code: 'BG', name: 'Bulgaria' },
  { code: 'CH', name: 'Switzerland' },
  { code: 'CY', name: 'Cyprus' },
  { code: 'CZ', name: 'Czech Republic' },
  { code: 'DE', name: 'Germany' },
  { code: 'DK', name: 'Denmark' },
  { code: 'EE', name: 'Estonia' },
  { code: 'ES', name: 'Spain' },
  { code: 'FI', name: 'Finland' },
  { code: 'FR', name: 'France' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'GR', name: 'Greece' },
  { code: 'HR', name: 'Croatia' },
  { code: 'HU', name: 'Hungary' },
  { code: 'IE', name: 'Ireland' },
  { code: 'IS', name: 'Iceland' },
  { code: 'IT', name: 'Italy' },
  { code: 'LI', name: 'Liechtenstein' },
  { code: 'LT', name: 'Lithuania' },
  { code: 'LU', name: 'Luxembourg' },
  { code: 'LV', name: 'Latvia' },
  { code: 'MT', name: 'Malta' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'NO', name: 'Norway' },
  { code: 'PL', name: 'Poland' },
  { code: 'PT', name: 'Portugal' },
  { code: 'RO', name: 'Romania' },
  { code: 'SE', name: 'Sweden' },
  { code: 'SI', name: 'Slovenia' },
  { code: 'SK', name: 'Slovakia' },
  { code: 'US', name: 'United States' },
];

type FieldKey = keyof ProfileInitial;

export function ProfileForm({ initial, save }: Props) {
  const [values, setValues] = useState<ProfileInitial>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const [vat, setVat] = useState<VatState>({ status: 'idle' });
  const vatDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  function set(key: FieldKey, value: string) {
    setValues((v) => ({ ...v, [key]: value }));
    if (key === 'vatId') {
      setVat({ status: 'idle' });
    }
  }

  // why: VIES is slow and rate-sensitive — debounce so users typing the
  // number don't trigger a call per keystroke. Empty string clears the
  // state instead of hitting the endpoint.
  useEffect(() => {
    if (vatDebounce.current) clearTimeout(vatDebounce.current);
    const trimmed = values.vatId.trim();
    if (trimmed.length === 0) {
      setVat({ status: 'idle' });
      return;
    }
    vatDebounce.current = setTimeout(async () => {
      setVat({ status: 'checking' });
      try {
        const res = await fetch(
          `/api/v1/billing/vat/check?id=${encodeURIComponent(trimmed)}`,
          { credentials: 'include' },
        );
        if (!res.ok) {
          setVat({ status: 'unverifiable', reason: `http_${res.status}` });
          return;
        }
        const data = (await res.json()) as
          | { state: 'valid'; name: string | null; address: string | null }
          | { state: 'invalid'; reason: string }
          | { state: 'unverifiable'; reason: string };
        if (data.state === 'valid') {
          setVat({ status: 'valid', name: data.name, address: data.address });
        } else if (data.state === 'invalid') {
          setVat({ status: 'invalid', reason: data.reason });
        } else {
          setVat({ status: 'unverifiable', reason: data.reason });
        }
      } catch (err) {
        setVat({
          status: 'unverifiable',
          reason: err instanceof Error ? err.message : 'vat_check_failed',
        });
      }
    }, 600);
    return () => {
      if (vatDebounce.current) clearTimeout(vatDebounce.current);
    };
  }, [values.vatId]);

  function dirty(): boolean {
    return (Object.keys(values) as FieldKey[]).some((k) => values[k] !== initial[k]);
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!dirty()) return;
    setError(null);
    setSaved(false);
    // Only send changed fields so omitted ones stay as-is server-side.
    const patch: Record<string, string | null> = {};
    (Object.keys(values) as FieldKey[]).forEach((k) => {
      if (values[k] !== initial[k]) {
        patch[k] = values[k].trim().length === 0 ? null : values[k].trim();
      }
    });
    startTransition(async () => {
      try {
        await save(patch);
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'save failed');
      }
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-4 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-5"
    >
      <Field label="display name" value={values.name} onChange={(v) => set('name', v)} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label="legal name"
          hint="as it appears on your id / company registration"
          value={values.legalName}
          onChange={(v) => set('legalName', v)}
        />
        <Field
          label="company name"
          hint="optional — leave blank for individuals"
          value={values.companyName}
          onChange={(v) => set('companyName', v)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Field
          label="vat id / tax id"
          hint="EU VAT (e.g. BE0123456789) for reverse-charge B2B invoicing"
          value={values.vatId}
          onChange={(v) => set('vatId', v)}
        />
        <VatStatusLine state={vat} />
      </div>

      <div>
        <span className="font-mono text-xs text-[var(--color-text-muted)]">billing address</span>
        <div className="mt-2 flex flex-col gap-3">
          <Field
            label="address line 1"
            value={values.addressLine1}
            onChange={(v) => set('addressLine1', v)}
          />
          <Field
            label="address line 2"
            value={values.addressLine2}
            onChange={(v) => set('addressLine2', v)}
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_160px]">
            <Field label="city" value={values.addressCity} onChange={(v) => set('addressCity', v)} />
            <Field
              label="postal code"
              value={values.addressPostalCode}
              onChange={(v) => set('addressPostalCode', v)}
            />
          </div>
          <Field
            label="region / state"
            value={values.addressRegion}
            onChange={(v) => set('addressRegion', v)}
          />
          <label className="flex flex-col gap-2">
            <span className="font-mono text-xs text-[var(--color-text-muted)]">country</span>
            <select
              value={values.addressCountry}
              onChange={(e) => set('addressCountry', e.currentTarget.value)}
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--color-primary)]"
            >
              <option value="">— select —</option>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name} ({c.code})
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 pt-2">
        <div className="font-mono text-xs">
          {error ? (
            <span role="alert" className="text-red-400">
              {error}
            </span>
          ) : saved ? (
            <span className="text-[var(--color-primary)]">saved ✓</span>
          ) : null}
        </div>
        <button
          type="submit"
          disabled={pending || !dirty()}
          className="rounded-md bg-[var(--color-primary)] px-4 py-2 font-mono text-sm font-medium text-[var(--color-text-inverse)] disabled:opacity-40"
        >
          {pending ? 'saving...' : 'save changes'}
        </button>
      </div>
    </form>
  );
}

function VatStatusLine({ state }: { state: VatState }) {
  if (state.status === 'idle') return null;
  if (state.status === 'checking') {
    return (
      <p className="font-mono text-xs text-[var(--color-text-subtle)]">checking with VIES…</p>
    );
  }
  if (state.status === 'valid') {
    return (
      <p className="font-mono text-xs text-[var(--color-primary)]">
        valid ✓ {state.name ? `· ${state.name}` : null}
        {state.address ? (
          <span className="block text-[var(--color-text-subtle)]">{state.address}</span>
        ) : null}
      </p>
    );
  }
  if (state.status === 'invalid') {
    return (
      <p role="alert" className="font-mono text-xs text-red-400">
        not registered with VIES ({state.reason})
      </p>
    );
  }
  return (
    <p className="font-mono text-xs text-amber-400">
      couldn't reach VIES ({state.reason}) — we'll re-check on save
    </p>
  );
}

function Field({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="font-mono text-xs text-[var(--color-text-muted)]">
        {label}
        {hint ? (
          <span className="ml-2 text-[var(--color-text-subtle)]">({hint})</span>
        ) : null}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--color-primary)]"
      />
    </label>
  );
}
