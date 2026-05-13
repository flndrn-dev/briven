'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';

interface Props {
  projectId: string;
  apiOrigin: string;
}

interface UploadResponse {
  file: { id: string; name: string };
  uploadUrl: string;
  requiredHeaders: Record<string, string>;
}

export function UploadButton({ projectId, apiOrigin }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ name: string; pct: number } | null>(null);
  const [isPending, startTransition] = useTransition();

  function pick() {
    setError(null);
    inputRef.current?.click();
  }

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setProgress({ name: file.name, pct: 0 });
    try {
      // 1. Ask the API for a presigned PUT URL. The api enforces auth +
      //    project role; no plaintext credentials cross to the browser.
      const reqRes = await fetch(`${apiOrigin}/v1/projects/${projectId}/files/upload-url`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: file.name,
          contentType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
        }),
      });
      if (!reqRes.ok) {
        const body = await reqRes.text().catch(() => '');
        throw new Error(body || `upload-url failed: ${reqRes.status}`);
      }
      const presigned = (await reqRes.json()) as UploadResponse;

      // 2. Upload bytes directly to MinIO via the presigned URL. The
      //    Content-Type header MUST match what the api signed.
      await uploadWithProgress(presigned.uploadUrl, file, presigned.requiredHeaders, (pct) =>
        setProgress({ name: file.name, pct }),
      );

      setProgress({ name: file.name, pct: 100 });
      // 3. Refresh server component so the new row appears in the list.
      startTransition(() => {
        router.refresh();
        setProgress(null);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'upload failed');
      setProgress(null);
    } finally {
      // Reset the input so the same file can be picked again.
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={onChange}
        disabled={isPending || progress !== null}
      />
      <button
        type="button"
        onClick={pick}
        disabled={isPending || progress !== null}
        className="inline-flex h-9 items-center justify-center rounded-md bg-[var(--color-primary)] px-4 font-sans text-sm text-[var(--color-text-inverse)] transition-colors hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
      >
        upload file
      </button>

      {progress ? (
        <div className="flex flex-col gap-1">
          <p className="font-mono text-xs text-[var(--color-text-muted)]">
            {progress.name} · {progress.pct}%
          </p>
          <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--color-surface-raised)]">
            <div
              className="h-full bg-[var(--color-primary)] transition-[width]"
              style={{ width: `${progress.pct}%` }}
            />
          </div>
        </div>
      ) : null}

      {error ? <p className="font-mono text-xs text-[var(--color-error)]">{error}</p> : null}
    </div>
  );
}

// XHR is the only way to get an upload progress event in the browser
// (fetch streams aren't broadly supported for uploads yet, and even
// where they are the progress is per-chunk, not per-byte). We're not
// shy about using XHR for this one slice; the rest of the app stays
// on fetch.
function uploadWithProgress(
  url: string,
  body: Blob,
  headers: Record<string, string>,
  onProgress: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`upload PUT failed: ${xhr.status} ${xhr.responseText.slice(0, 200)}`));
    });
    xhr.addEventListener('error', () => reject(new Error('upload network error')));
    xhr.addEventListener('abort', () => reject(new Error('upload aborted')));
    xhr.send(body);
  });
}
