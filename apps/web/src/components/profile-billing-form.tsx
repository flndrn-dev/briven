'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { COUNTRIES_EU, COUNTRIES_REST } from '../lib/countries';
import { notifyDashboardChange } from './live-refresh';

type VatState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'valid'; name: string | null; address: string | null }
  | { status: 'invalid'; reason: string }
  | { status: 'unverifiable'; reason: string };

export interface ProfileInitial {
  name: string;
  legalName: string;
  companyName: string;
  companyRegistrationNumber: string;
  vatId: string;
  addressLine1: string;
  addressLine2: string;
  addressCity: string;
  addressPostalCode: string;
  addressRegion: string;
  addressCountry: string;
  dateOfBirth: string;
  countryOfBirth: string;
  timezone: string;
}

interface Props {
  initial: ProfileInitial;
  currentImage: string | null;
  displayName: string;
  vatLocked: boolean;
  save: (
    patch: Record<string, string | null>,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
}

type FieldKey = keyof ProfileInitial;

// Full IANA timezone list. `Intl.supportedValuesOf('timeZone')` returns
// every zone the browser's tzdata knows about (~440 today). Sorted
// alphabetically so the dropdown is scannable. Falls back to a curated
// short list when the API is unavailable (very old browsers, SSR before
// React hydration on engines that don't expose it).
const TIMEZONES: readonly string[] = (() => {
  try {
    const all = Intl.supportedValuesOf('timeZone');
    return [...all].sort();
  } catch {
    return [
      'Europe/Brussels',
      'Europe/Amsterdam',
      'Europe/Paris',
      'Europe/Berlin',
      'Europe/London',
      'America/New_York',
      'America/Los_Angeles',
      'Asia/Tokyo',
      'Australia/Sydney',
      'UTC',
    ];
  }
})();

function formatTzOffset(iana: string): string {
  try {
    const date = new Date();
    const f = new Intl.DateTimeFormat('en-US', {
      timeZone: iana,
      timeZoneName: 'longOffset',
    });
    const parts = f.formatToParts(date);
    const tzPart = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
    return tzPart.replace(/^GMT/, 'UTC') || 'UTC';
  } catch {
    return '';
  }
}

function detectBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function ProfileBillingForm({
  initial,
  currentImage,
  displayName,
  vatLocked,
  save,
}: Props) {
  const router = useRouter();
  const [values, setValues] = useState<ProfileInitial>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const [vat, setVat] = useState<VatState>({ status: 'idle' });
  const vatDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!values.timezone) {
      setValues((v) => ({ ...v, timezone: detectBrowserTimezone() }));
    }
    // Intentional mount-only effect: detectBrowserTimezone is module-scoped and
    // setValues uses a functional updater, so no closure-stale-value risk.
  }, []);

  const tzOffset = useMemo(() => formatTzOffset(values.timezone || 'UTC'), [values.timezone]);
  const tzChip = values.timezone
    ? `${values.timezone}${tzOffset ? ` · ${tzOffset}` : ''}`
    : '—';

  function set(key: FieldKey, value: string) {
    setValues((v) => ({ ...v, [key]: value }));
    if (key === 'vatId') setVat({ status: 'idle' });
  }

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
        const res = await fetch(`/api/v1/billing/vat/check?id=${encodeURIComponent(trimmed)}`, {
          credentials: 'include',
        });
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
    const patch: Record<string, string | null> = {};
    (Object.keys(values) as FieldKey[]).forEach((k) => {
      if (values[k] !== initial[k]) {
        const trimmed = values[k].trim();
        patch[k] = trimmed.length === 0 ? null : trimmed;
      }
    });
    startTransition(async () => {
      try {
        const result = await save(patch);
        if (result.ok) {
          setSaved(true);
          setTimeout(() => setSaved(false), 3000);
          router.refresh();
          notifyDashboardChange();
        } else {
          setError(result.error);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'save failed');
      }
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-0 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface)]"
    >
      <header className="flex flex-col gap-2 px-6 pt-5 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-base font-semibold text-[var(--color-text)]">
            Profile &amp; billing details
          </h3>
          <span className="inline-flex shrink-0 items-center rounded-md border border-[var(--color-border-primary)] bg-[var(--color-primary-subtle)] px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-[var(--color-primary)]">
            {tzChip}
          </span>
        </div>
        <p className="max-w-xl text-xs text-[var(--color-text-muted)]">
          Your avatar, plus the address and identity info we&apos;re required to keep on file
          for any paid subscription under EU regulation.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-5 px-6 pt-2 pb-5">
        <AvatarSlot currentImage={currentImage} displayName={displayName} />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
            Profile picture
          </span>
          <AvatarActions currentImage={currentImage} />
          <p className="text-xs text-[var(--color-text-muted)]">
            PNG, JPEG, or WebP. Max 8 MB before resizing. We downscale to 256×256 in your browser.
          </p>
        </div>
      </div>

      <div className="border-t border-[var(--color-border-subtle)]" />

      <section className="flex flex-col gap-4 px-6 pt-5 pb-2">
        <div>
          <h4 className="text-sm font-semibold text-[var(--color-text)]">Invoicing identity</h4>
          <p className="mt-1 max-w-2xl text-xs text-[var(--color-text-muted)]">
            How you&apos;re addressed on invoices and in emails. Company and VAT ID are only
            needed for B2B invoicing — leave blank if you&apos;re billing as an individual.
          </p>
        </div>

        <LabeledInput
          label="Display name"
          placeholder="e.g. Jane Doe"
          hint="Shown in the dashboard header and product UI."
          value={values.name}
          onChange={(v) => set('name', v)}
        />

        <LabeledInput
          label="Legal name"
          placeholder="As on your ID or company registration"
          hint="Used on invoices and for KYC. Required before any paid checkout."
          value={values.legalName}
          onChange={(v) => set('legalName', v)}
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <LabeledInput
            label="Company name"
            placeholder="Acme Ltd."
            hint="Optional — leave blank for individuals."
            value={values.companyName}
            onChange={(v) => set('companyName', v)}
          />
          <LabeledInput
            label="Company registration no."
            placeholder="e.g. SIREN 123456789"
            hint="EU business register number. Separate from VAT ID — many micro-businesses register without VAT."
            value={values.companyRegistrationNumber}
            onChange={(v) => set('companyRegistrationNumber', v)}
          />
          <div className="flex flex-col gap-1.5">
            <LabeledInput
              label="VAT ID / tax ID"
              placeholder="BE0123456789"
              hint="EU VAT (e.g. BE0123456789) for reverse-charge B2B invoicing."
              value={values.vatId}
              onChange={(v) => set('vatId', v)}
              readOnly={vatLocked}
            />
            {vatLocked ? (
              <p className="text-xs text-[var(--color-text-subtle)]">
                VAT verified ✓ · locked. To change a verified VAT ID, reach us via our{' '}
                <Link
                  href="/contact?topic=support"
                  className="text-[var(--color-text-link)] underline-offset-2 hover:underline"
                >
                  contact form
                </Link>{' '}
                with the new ID + reason — we re-verify against VIES on our side.
              </p>
            ) : (
              <VatStatusLine state={vat} />
            )}
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-4 px-6 pt-6 pb-5">
        <div>
          <h4 className="text-sm font-semibold text-[var(--color-text)]">
            Billing address &amp; KYC
          </h4>
          <p className="mt-1 max-w-2xl text-xs text-[var(--color-text-muted)]">
            EU regulation requires us to collect this for any paid subscription. Polar also uses
            it for VAT calculation on invoices. Saved fields are encrypted at rest on the briven
            control plane.
          </p>
        </div>

        <LabeledInput
          label="Address line 1"
          value={values.addressLine1}
          onChange={(v) => set('addressLine1', v)}
        />
        <LabeledInput
          label="Address line 2"
          placeholder="Apartment, unit, etc. (optional)"
          value={values.addressLine2}
          onChange={(v) => set('addressLine2', v)}
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <LabeledInput
            label="Postal code"
            value={values.addressPostalCode}
            onChange={(v) => set('addressPostalCode', v)}
          />
          <LabeledInput
            label="City"
            value={values.addressCity}
            onChange={(v) => set('addressCity', v)}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <LabeledInput
            label="State / province / region"
            value={values.addressRegion}
            onChange={(v) => set('addressRegion', v)}
          />
          <LabeledSelect
            label="Country (residency)"
            value={values.addressCountry}
            onChange={(v) => set('addressCountry', v)}
            hint="Countries under US OFAC sanctions are disabled — we're unable to onboard customers from those jurisdictions."
          >
            <option value="">— select —</option>
            <optgroup label="EU / EEA / UK / CH">
              {COUNTRIES_EU.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Rest of world">
              {COUNTRIES_REST.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </optgroup>
          </LabeledSelect>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <LabeledInput
            label="Date of birth"
            type="date"
            value={values.dateOfBirth}
            onChange={(v) => set('dateOfBirth', v)}
          />
          <LabeledInput
            label="Country of birth (ISO 2-letter)"
            value={values.countryOfBirth}
            onChange={(v) => set('countryOfBirth', v.toUpperCase().slice(0, 2))}
            maxLength={2}
            pattern="[A-Z]{2}"
            placeholder="BE"
          />
        </div>

        <LabeledSelect
          label="Timezone"
          value={values.timezone}
          onChange={(v) => set('timezone', v)}
          hint="Used to schedule your weekly Pro digest at 09:00 your local time (instead of 09:00 UTC) and to render timestamps in alert emails in your timezone. Auto-detected from your browser; override if you're traveling or behind a VPN."
        >
          {TIMEZONES.map((tz) => {
            const offset = formatTzOffset(tz);
            return (
              <option key={tz} value={tz}>
                {tz}
                {offset ? ` · ${offset}` : ''}
              </option>
            );
          })}
        </LabeledSelect>
      </section>

      <div className="flex flex-wrap items-center gap-3 px-6 pb-6">
        <button
          type="submit"
          disabled={pending || !dirty()}
          className="rounded-md bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-[var(--color-text-inverse)] transition hover:bg-[var(--color-primary-hover)] disabled:opacity-40"
        >
          {pending ? 'Saving…' : 'Save changes'}
        </button>
        <div className="text-xs">
          {error ? (
            <span role="alert" className="text-red-400">
              {error}
            </span>
          ) : saved ? (
            <span className="text-[var(--color-primary)]">saved ✓</span>
          ) : null}
        </div>
      </div>
    </form>
  );
}

function AvatarSlot({
  currentImage,
  displayName,
}: {
  currentImage: string | null;
  displayName: string;
}) {
  if (currentImage) {
    return (
      <img
        src={currentImage}
        alt="avatar"
        width={80}
        height={80}
        className="size-20 rounded-full object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden
      className="flex size-20 items-center justify-center rounded-full bg-[var(--color-primary-subtle)] font-mono text-2xl text-[var(--color-primary)]"
    >
      {getInitials(displayName)}
    </span>
  );
}

function AvatarActions({ currentImage }: { currentImage: string | null }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function onFile(file: File) {
    setError(null);
    if (!file.type.startsWith('image/')) {
      setError('file must be an image');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setError('image must be under 8 MB before resizing');
      return;
    }
    try {
      const dataUri = await resizeToDataUri(file);
      startTransition(async () => {
        const res = await fetch('/api/v1/me/avatar', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ dataUri }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { message?: string };
          setError(body.message ?? `upload failed: ${res.status}`);
          return;
        }
        router.refresh();
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'upload failed');
    }
  }

  function onRemove() {
    setError(null);
    startTransition(async () => {
      const res = await fetch('/api/v1/me/avatar', {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        setError(body.message ?? `remove failed: ${res.status}`);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => fileRef.current?.click()}
        className="rounded-md bg-[var(--color-primary)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-inverse)] transition hover:bg-[var(--color-primary-hover)] disabled:opacity-40"
      >
        {currentImage ? 'Replace picture' : 'Upload picture'}
      </button>
      {currentImage ? (
        <button
          type="button"
          disabled={pending}
          onClick={onRemove}
          className="rounded-md border border-[var(--color-border-subtle)] bg-transparent px-3 py-1.5 text-xs text-[var(--color-text-muted)] transition hover:border-[var(--color-border)] hover:text-[var(--color-error)] disabled:opacity-40"
        >
          Remove
        </button>
      ) : null}
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          if (f) void onFile(f);
          e.currentTarget.value = '';
        }}
      />
      {error ? (
        <span role="alert" className="text-xs text-red-400">
          {error}
        </span>
      ) : null}
    </div>
  );
}

function VatStatusLine({ state }: { state: VatState }) {
  if (state.status === 'idle') return null;
  if (state.status === 'checking') {
    return <p className="text-xs text-[var(--color-text-subtle)]">Checking with VIES…</p>;
  }
  if (state.status === 'valid') {
    return (
      <p className="text-xs text-[var(--color-primary)]">
        Valid ✓ {state.name ? `· ${state.name}` : null}
        {state.address ? (
          <span className="block text-[var(--color-text-subtle)]">{state.address}</span>
        ) : null}
      </p>
    );
  }
  if (state.status === 'invalid') {
    return (
      <p role="alert" className="text-xs text-red-400">
        Not registered with VIES ({state.reason})
      </p>
    );
  }
  return (
    <p className="text-xs text-amber-400">
      Couldn&apos;t reach VIES ({state.reason}) — we&apos;ll re-check on save
    </p>
  );
}

function LabeledInput({
  label,
  hint,
  value,
  onChange,
  readOnly,
  type,
  placeholder,
  maxLength,
  pattern,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  readOnly?: boolean;
  type?: string;
  placeholder?: string;
  maxLength?: number;
  pattern?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
        {label}
      </span>
      <input
        type={type ?? 'text'}
        value={value}
        readOnly={readOnly}
        placeholder={placeholder}
        maxLength={maxLength}
        pattern={pattern}
        onChange={(e) => onChange(e.currentTarget.value)}
        aria-readonly={readOnly ? 'true' : undefined}
        className={`rounded-md border px-3 py-2 text-sm outline-none ${
          readOnly
            ? 'cursor-not-allowed border-[var(--color-border-subtle)] bg-[var(--color-surface)] text-[var(--color-text-muted)]'
            : 'border-[var(--color-border)] bg-[var(--color-surface-raised)] text-[var(--color-text)] focus:border-[var(--color-primary)]'
        }`}
      />
      {hint ? <span className="text-xs text-[var(--color-text-subtle)]">{hint}</span> : null}
    </label>
  );
}

function LabeledSelect({
  label,
  hint,
  value,
  onChange,
  children,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
      >
        {children}
      </select>
      {hint ? <span className="text-xs text-[var(--color-text-subtle)]">{hint}</span> : null}
    </label>
  );
}

function resizeToDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('could not read file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('could not decode image'));
      img.onload = () => {
        const TARGET = 256;
        const size = Math.min(img.naturalWidth, img.naturalHeight);
        const sx = (img.naturalWidth - size) / 2;
        const sy = (img.naturalHeight - size) / 2;
        const canvas = document.createElement('canvas');
        canvas.width = TARGET;
        canvas.height = TARGET;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('canvas unavailable'));
          return;
        }
        ctx.drawImage(img, sx, sy, size, size, 0, 0, TARGET, TARGET);
        const webp = canvas.toDataURL('image/webp', 0.85);
        if (webp.startsWith('data:image/webp')) {
          resolve(webp);
          return;
        }
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

function getInitials(source: string): string {
  const cleaned = source.trim();
  if (!cleaned) return '·';
  const parts = cleaned.includes('@') ? [cleaned.split('@')[0]!] : cleaned.split(/\s+/);
  const letters = parts
    .slice(0, 2)
    .map((p) => p[0])
    .filter(Boolean)
    .join('');
  return (letters || cleaned[0] || '·').toUpperCase();
}
