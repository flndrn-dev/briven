'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

const ACCEPT = 'image/png,image/jpeg,image/webp,image/svg+xml';
const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']);
const MAX_BYTES = 1024 * 1024; // 1 MiB — must match the api cap

interface Props {
  projectId: string;
  initialLogoUrl: string | null;
}

/**
 * Logo uploader for the auth → branding panel. Replaces the old "paste a
 * public URL" text field with a real file picker.
 *
 * Uploads go straight to the api via the `/api/*` rewrite as multipart
 * form-data — NOT through `apiJson`, which forces a JSON content-type that
 * would break the multipart boundary. The api stores the file privately in
 * MinIO and returns a STABLE public `logoUrl` (served back by an
 * unauthenticated CDN-style route), which we then show as the preview.
 */
export function LogoUploader({ projectId, initialLogoUrl }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(initialLogoUrl);
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  function pick(next: File | null): void {
    setErrMsg(null);
    if (!next) {
      setFile(null);
      return;
    }
    if (!ALLOWED.has(next.type)) {
      setFile(null);
      setErrMsg('must be a PNG, JPEG, WEBP, or SVG image');
      return;
    }
    if (next.size > MAX_BYTES) {
      setFile(null);
      setErrMsg('image must be 1 MB or smaller');
      return;
    }
    setFile(next);
  }

  async function upload(): Promise<void> {
    if (!file) return;
    setPending(true);
    setErrMsg(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`/api/v1/projects/${projectId}/auth/branding/logo`, {
        method: 'POST',
        credentials: 'include',
        body: form,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
        throw new Error(body.message ?? body.code ?? `http ${res.status}`);
      }
      const body = (await res.json()) as { logoUrl: string };
      setLogoUrl(body.logoUrl);
      setFile(null);
      if (inputRef.current) inputRef.current.value = '';
      router.refresh();
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'upload failed');
    } finally {
      setPending(false);
    }
  }

  async function remove(): Promise<void> {
    setPending(true);
    setErrMsg(null);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/auth/branding/logo`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
        throw new Error(body.message ?? body.code ?? `http ${res.status}`);
      }
      setLogoUrl(null);
      setFile(null);
      if (inputRef.current) inputRef.current.value = '';
      router.refresh();
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'remove failed');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4">
      <h3 className="font-mono text-sm text-[var(--color-text)]">logo</h3>
      <p className="mt-1 mb-3 font-mono text-[11px] text-[var(--color-text-muted)]">
        upload a PNG, JPEG, WEBP, or SVG (max 1 MB). shown in the top-left of
        hosted login pages.
      </p>

      {logoUrl ? (
        <div className="mb-3 flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={logoUrl}
            alt="current logo"
            className="h-10 w-auto max-w-[12rem] rounded-sm border border-[var(--color-border)] bg-[var(--color-surface)] object-contain p-1"
          />
          <span className="font-mono text-[11px] text-[var(--color-text-muted)]">current logo</span>
        </div>
      ) : (
        <p className="mb-3 font-mono text-[11px] text-[var(--color-text-subtle)]">
          no logo set — the briven default mark is used.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          onChange={(e) => pick(e.target.files?.[0] ?? null)}
          className="max-w-md font-mono text-xs text-[var(--color-text)] file:mr-3 file:rounded-sm file:border file:border-[var(--color-border)] file:bg-[var(--color-surface)] file:px-2 file:py-1 file:font-mono file:text-xs file:text-[var(--color-text)] hover:file:border-[var(--color-primary)]"
        />
        <button
          type="button"
          onClick={() => void upload()}
          disabled={!file || pending}
          className="rounded-md bg-[var(--color-primary)] px-4 py-2 font-mono text-xs font-medium text-[var(--color-text-inverse)] transition hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
        >
          {pending ? 'uploading…' : 'upload logo'}
        </button>
        {logoUrl ? (
          <button
            type="button"
            onClick={() => void remove()}
            disabled={pending}
            className="rounded-md border border-[var(--color-border)] px-4 py-2 font-mono text-xs text-[var(--color-text-muted)] transition hover:border-[var(--color-error)] hover:text-[var(--color-error)] disabled:opacity-50"
          >
            remove
          </button>
        ) : null}
      </div>

      {errMsg ? (
        <p className="mt-2 font-mono text-[11px] text-[var(--color-error)]">{errMsg}</p>
      ) : null}
    </div>
  );
}
