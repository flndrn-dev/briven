'use client';

import { useCallback, useState } from 'react';

import { CopyIcon } from '@/components/ui/copy';

interface Props {
  projectId: string;
  keyId: string;
}

interface RevealResponse {
  plaintext?: string;
}

interface ErrorBody {
  code?: string;
  message?: string;
}

/**
 * Copy-again for an existing SDK key. Modelled on `components/ui/copy-button`
 * (animated copy icon → thick green check for ~2s) but it FETCHES the
 * plaintext first: it POSTs to the authenticated + audited reveal endpoint,
 * writes the returned value straight to the clipboard, and flashes the check.
 *
 * The key text is NEVER displayed — no eye/reveal affordance, copy only. Old
 * keys (created before encrypted-at-rest storage) and revoked keys come back
 * as `key_not_revealable`; we show a small inline hint to rotate instead.
 */
export function CopyKeyButton({ projectId, keyId }: Props) {
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const onClick = useCallback(() => {
    void (async () => {
      setPending(true);
      setErrMsg(null);
      try {
        const res = await fetch(
          `/api/v1/projects/${projectId}/auth/api-keys/${keyId}/reveal`,
          { method: 'POST', credentials: 'include' },
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as ErrorBody;
          if (body.code === 'key_not_revealable') {
            setErrMsg('rotate to get a copyable key');
          } else {
            setErrMsg('copy failed');
          }
          return;
        }
        const body = (await res.json()) as RevealResponse;
        if (!body.plaintext) {
          setErrMsg('copy failed');
          return;
        }
        await navigator.clipboard.writeText(body.plaintext);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        setErrMsg('copy failed');
      } finally {
        setPending(false);
      }
    })();
  }, [projectId, keyId]);

  if (errMsg) {
    return (
      <span
        className="font-mono text-[10px] text-[var(--color-text-muted)]"
        title={errMsg}
      >
        {errMsg}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      aria-label={copied ? 'copied' : 'copy key'}
      title={copied ? 'copied!' : 'copy key'}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--color-border)] px-2 py-1 font-mono text-[10px] text-[var(--color-text-muted)] transition hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-primary)] disabled:opacity-50"
    >
      {copied ? (
        <svg
          width={14}
          height={14}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-[var(--color-primary)]"
          aria-hidden="true"
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
      ) : (
        <CopyIcon size={14} aria-hidden="true" />
      )}
      <span className={copied ? 'text-[var(--color-primary)]' : ''}>
        {copied ? 'copied!' : pending ? '…' : 'copy'}
      </span>
    </button>
  );
}
