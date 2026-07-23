'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

type Chip = {
  id: string;
  label: string;
  kind: 'core' | 'oauth';
  enabled: boolean;
  configured: boolean;
  hrefSuffix: string;
};

const CORE_FLAG: Record<string, string> = {
  emailPassword: 'emailPassword',
  'passwordless-email': 'passwordlessEmail',
  'magic-link': 'magicLink',
  'passwordless-sms': 'passwordlessSms',
  passkeys: 'passkeys',
  mfa: 'mfa',
};

/**
 * Click a core method to toggle it for this project.
 * Highlighted = on for this project only.
 */
export function ProjectMethodsPanel({
  projectId,
  coreChips,
  methods,
}: {
  projectId: string;
  coreChips: Chip[];
  methods: Record<string, boolean>;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [local, setLocal] = useState(methods);

  async function toggle(chip: Chip): Promise<void> {
    const flagKey = CORE_FLAG[chip.id];
    if (!flagKey) return;
    const next = !Boolean(local[flagKey] ?? chip.enabled);
    setPending(chip.id);
    setErr(null);
    try {
      const res = await fetch(
        `/api/v1/auth-core/projects/${projectId}/methods`,
        {
          method: 'PUT',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ [flagKey]: next }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as {
        message?: string;
        methods?: Record<string, boolean>;
      };
      if (!res.ok) throw new Error(body.message ?? `http ${res.status}`);
      if (body.methods) setLocal(body.methods);
      else setLocal((m) => ({ ...m, [flagKey]: next }));
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'could not update method');
    } finally {
      setPending(null);
    }
  }

  if (coreChips.length === 0) {
    return (
      <p className="mt-3 font-mono text-xs text-[var(--color-text-muted)]">
        methods will show after Auth config loads
      </p>
    );
  }

  return (
    <div className="mt-3 space-y-2">
      <ul className="flex flex-wrap gap-2">
        {coreChips.map((c) => {
          const flagKey = CORE_FLAG[c.id] ?? c.id;
          const on = Boolean(local[flagKey] ?? c.enabled);
          return (
            <li key={c.id}>
              <button
                type="button"
                disabled={pending === c.id}
                onClick={() => void toggle(c)}
                title={
                  on
                    ? 'on for this project — click to turn off'
                    : 'off for this project — click to turn on'
                }
                className="rounded border px-2.5 py-1.5 font-mono text-[11px] disabled:opacity-50"
                style={{
                  borderColor: 'var(--auth-accent-border)',
                  background: on ? 'var(--auth-accent-soft)' : 'transparent',
                  color: 'var(--color-text)',
                }}
              >
                {c.label}
                {on ? '' : ' · off'}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="font-mono text-[10px] text-[var(--color-text-muted)]">
        yellow = on for this project only. For phone codes, open{' '}
        <Link
          href={`/dashboard/auth/${projectId}/providers?method=passwordlessSms#auth-sms-setup`}
          className="underline"
          style={{ color: 'var(--auth-accent, #FFFD74)' }}
        >
          Providers → SMS login (Twilio)
        </Link>
        .
      </p>
      {err ? (
        <p className="font-mono text-xs text-red-400">{err}</p>
      ) : null}
    </div>
  );
}
