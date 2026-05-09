'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  currentImage: string | null;
  displayName: string;
}

// Rendered 256x256 webp; matches the dimensions the header/sidebar avatars use
// (the components scale down in CSS). Any larger is wasted bytes.
const TARGET_EDGE = 256;
const JPEG_QUALITY = 0.85;

/**
 * Square-crops and resizes the picked image client-side via a canvas, then
 * POSTs the resulting data URI to the API. Keeps the payload at ~20-40 KiB
 * regardless of what the user picks, so the `users.image` column stays
 * bounded and the avatar renders crisply at any size.
 */
export function AvatarUploader({ currentImage, displayName }: Props) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(currentImage);
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
      setPreview(dataUri);
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
          setPreview(currentImage);
          return;
        }
        router.refresh();
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'upload failed');
      setPreview(currentImage);
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
      setPreview(null);
      router.refresh();
    });
  }

  const initials = getInitials(displayName);

  return (
    <div className="flex items-center gap-5 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-5">
      <div className="relative">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview}
            alt="avatar preview"
            width={72}
            height={72}
            className="size-[72px] rounded-full object-cover"
          />
        ) : (
          <span
            aria-hidden
            className="flex size-[72px] items-center justify-center rounded-full bg-[var(--color-primary-subtle)] font-mono text-2xl text-[var(--color-primary)]"
          >
            {initials}
          </span>
        )}
        {pending ? (
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 text-xs text-white">
            …
          </span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-2">
        <p className="font-mono text-xs text-[var(--color-text-muted)]">
          avatar · 256×256 webp · PNG, JPEG, or WEBP accepted; we downscale and re-encode in your
          browser
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => fileRef.current?.click()}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-1.5 font-mono text-xs transition-colors hover:border-[var(--color-border-strong)] disabled:opacity-40"
          >
            {preview ? 'replace' : 'upload'}
          </button>
          {preview ? (
            <button
              type="button"
              disabled={pending}
              onClick={onRemove}
              className="rounded-md border border-[var(--color-border-subtle)] bg-transparent px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-border)] hover:text-[var(--color-error)] disabled:opacity-40"
            >
              remove
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
        </div>
        {error ? (
          <p role="alert" className="font-mono text-xs text-red-400">
            {error}
          </p>
        ) : null}
      </div>
    </div>
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
        // Cover crop: take the largest centered square, scale to TARGET_EDGE.
        const size = Math.min(img.naturalWidth, img.naturalHeight);
        const sx = (img.naturalWidth - size) / 2;
        const sy = (img.naturalHeight - size) / 2;
        const canvas = document.createElement('canvas');
        canvas.width = TARGET_EDGE;
        canvas.height = TARGET_EDGE;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('canvas unavailable'));
          return;
        }
        ctx.drawImage(img, sx, sy, size, size, 0, 0, TARGET_EDGE, TARGET_EDGE);
        // Prefer webp; fall back to jpeg if the browser refuses.
        const webp = canvas.toDataURL('image/webp', JPEG_QUALITY);
        if (webp.startsWith('data:image/webp')) {
          resolve(webp);
          return;
        }
        resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
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
