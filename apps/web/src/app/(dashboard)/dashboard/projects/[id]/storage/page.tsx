import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { apiFetch, apiJson, ApiError } from '../../../../../../lib/api';
import { CopyLink } from './copy-link';
import { StorageKeysPanel } from './storage-keys-panel';
import { UploadButton } from './upload-button';

interface ProjectFile {
  id: string;
  name: string;
  objectKey: string;
  contentType: string;
  sizeBytes: string;
  uploadedBy: string | null;
  createdAt: string;
  deletedAt?: string | null;
}

interface FilesResult {
  files: ProjectFile[];
}

interface StorageKeyRow {
  id: string;
  name: string;
  accessKeyId: string;
  suffix: string;
  bucket: string;
  enabled: boolean;
  createdAt: string;
  revokedAt: string | null;
}

export const dynamic = 'force-dynamic';

// Public files are served from the media edge, not the api or minio origin.
const MEDIA_BASE = 'https://media.briven.tech';

// Surfaced from the api/lib/env helper on the server. The browser also
// needs an origin for direct PUT uploads — we pass it via prop so the
// client component doesn't read process.env at runtime.
function publicApiOrigin(): string {
  return process.env.NEXT_PUBLIC_BRIVEN_API_ORIGIN ?? '';
}

export default async function StoragePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // One-time secret from project create (httpOnly cookie, max 10 min).
  let initialCreated: {
    record: StorageKeyRow;
    endpoint: string;
    bucket: string;
    accessKey: string;
    secretKey: string;
  } | null = null;
  try {
    const jar = await cookies();
    const raw = jar.get(`briven_storage_once_${id}`)?.value;
    if (raw) {
      const parsed = JSON.parse(raw) as {
        endpoint: string;
        bucket: string;
        accessKey: string;
        secretKey: string;
        name?: string;
      };
      if (parsed.secretKey && parsed.accessKey) {
        initialCreated = {
          endpoint: parsed.endpoint,
          bucket: parsed.bucket,
          accessKey: parsed.accessKey,
          secretKey: parsed.secretKey,
          record: {
            id: 'pending',
            name: parsed.name ?? 'default',
            accessKeyId: parsed.accessKey,
            suffix: parsed.secretKey.slice(-4),
            bucket: parsed.bucket,
            enabled: true,
            createdAt: new Date().toISOString(),
            revokedAt: null,
          },
        };
      }
      jar.delete(`briven_storage_once_${id}`);
    }
  } catch {
    // ignore malformed flash
  }

  let files: ProjectFile[] = [];
  let deleted: ProjectFile[] = [];
  let storageKeys: StorageKeyRow[] = [];
  let storageEndpoint = '';
  let publicIds = new Set<string>();
  let notConfigured = false;
  try {
    const result = await apiJson<FilesResult>(`/v1/projects/${id}/files`);
    files = result.files;
    const pub = await apiJson<{ ids: string[] }>(
      `/v1/projects/${id}/files/public-ids`,
    ).catch(() => ({ ids: [] as string[] }));
    publicIds = new Set(pub.ids);
    const deletedResult = await apiJson<FilesResult>(
      `/v1/projects/${id}/files/deleted`,
    ).catch(() => ({ files: [] as ProjectFile[] }));
    deleted = deletedResult.files;
    const keysResult = await apiJson<{ keys: StorageKeyRow[]; endpoint?: string }>(
      `/v1/projects/${id}/storage-keys`,
    ).catch(() => ({ keys: [] as StorageKeyRow[], endpoint: '' }));
    storageKeys = keysResult.keys;
    storageEndpoint = keysResult.endpoint ?? '';
  } catch (err) {
    if (err instanceof ApiError && err.status === 503) {
      // BRIVEN_MINIO_* env vars not set on the api. The page still
      // renders so the operator sees a clear next-step message.
      notConfigured = true;
    } else {
      throw err;
    }
  }

  async function remove(formData: FormData) {
    'use server';
    const { id } = await params;
    const fileId = String(formData.get('fileId') ?? '');
    const res = await apiFetch(`/v1/projects/${id}/files/${fileId}`, { method: 'DELETE' });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(body || `delete failed: ${res.status}`);
    }
    revalidatePath(`/dashboard/projects/${id}/storage`);
  }

  async function restore(formData: FormData) {
    'use server';
    const { id } = await params;
    const fileId = String(formData.get('fileId') ?? '');
    const res = await apiFetch(`/v1/projects/${id}/files/${fileId}/restore`, { method: 'POST' });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      throw new Error(body?.message || `restore failed: ${res.status}`);
    }
    revalidatePath(`/dashboard/projects/${id}/storage`);
  }

  async function togglePublic(formData: FormData) {
    'use server';
    const { id } = await params;
    const fileId = String(formData.get('fileId') ?? '');
    const next = formData.get('next') === 'true';
    const res = await apiFetch(`/v1/projects/${id}/files/${fileId}/public`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ public: next }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      throw new Error(body?.message || `toggle public failed: ${res.status}`);
    }
    revalidatePath(`/dashboard/projects/${id}/storage`);
  }

  async function download(formData: FormData) {
    'use server';
    const { id } = await params;
    const fileId = String(formData.get('fileId') ?? '');
    const result = await apiJson<{ downloadUrl: string }>(
      `/v1/projects/${id}/files/${fileId}/download-url`,
    );
    redirect(result.downloadUrl);
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="font-mono text-sm text-[var(--color-text)]">S3 bucket</h2>
        <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
          this project&apos;s own private S3 bucket. everything is managed here in the dashboard —
          uploads and downloads happen through short-lived signed links, so the storage endpoint
          stays a locked door (no valid link, no access). you never need to touch it directly.
        </p>
      </header>

      {notConfigured ? (
        <div className="rounded-md border border-[var(--color-warning)] bg-[var(--color-surface)] p-4">
          <p className="font-mono text-sm text-[var(--color-text)]">storage is not configured.</p>
          <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
            the api host is missing <code>BRIVEN_MINIO_ENDPOINT</code>,{' '}
            <code>BRIVEN_MINIO_ACCESS_KEY</code>, or <code>BRIVEN_MINIO_SECRET_KEY</code>. set them
            and restart the api.
          </p>
        </div>
      ) : (
        <>
          <section className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-5">
            <UploadButton projectId={id} apiOrigin={publicApiOrigin()} />
          </section>

          <section className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="font-mono text-xs uppercase tracking-wider text-[var(--color-text-subtle)]">
                files ({files.length})
              </h3>
              {files.length > 0 ? (
                <p className="font-mono text-xs text-[var(--color-text-muted)]">
                  {formatBytes(files.reduce((sum, f) => sum + Number(f.sizeBytes), 0))} total
                </p>
              ) : null}
            </div>
            <p className="font-mono text-xs text-[var(--color-text-muted)]">
              public files are served from media.briven.tech and embeddable on your allowed domains.
            </p>
            {files.length === 0 ? (
              <p className="rounded-md border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-6 text-center font-mono text-sm text-[var(--color-text-muted)]">
                no files yet.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {files.map((f) => (
                  <li
                    key={f.id}
                    className="flex flex-col gap-2 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-3"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-mono text-sm text-[var(--color-text)]">
                          {f.name}
                        </p>
                        <p className="mt-0.5 font-mono text-xs text-[var(--color-text-muted)]">
                          {f.contentType} · {formatBytes(Number(f.sizeBytes))} ·{' '}
                          {new Date(f.createdAt).toISOString().slice(0, 16).replace('T', ' ')} utc
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <form action={togglePublic}>
                          <input type="hidden" name="fileId" value={f.id} />
                          <input type="hidden" name="next" value={String(!publicIds.has(f.id))} />
                          <button
                            type="submit"
                            className={
                              publicIds.has(f.id)
                                ? 'rounded-md border border-[var(--color-primary)] bg-[var(--color-primary)]/10 px-3 py-1.5 font-mono text-xs text-[var(--color-primary)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]'
                                : 'rounded-md border border-[var(--color-border-subtle)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)]'
                            }
                          >
                            {publicIds.has(f.id) ? 'make private' : 'make public'}
                          </button>
                        </form>
                        <form action={download}>
                          <input type="hidden" name="fileId" value={f.id} />
                          <button
                            type="submit"
                            className="rounded-md border border-[var(--color-border-subtle)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)]"
                          >
                            download
                          </button>
                        </form>
                        <form action={remove}>
                          <input type="hidden" name="fileId" value={f.id} />
                          <button
                            type="submit"
                            className="rounded-md border border-[var(--color-border-subtle)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] hover:border-[var(--color-error)] hover:text-[var(--color-error)]"
                          >
                            delete
                          </button>
                        </form>
                      </div>
                    </div>
                    {publicIds.has(f.id) ? (
                      <div className="flex items-center gap-2">
                        <code className="min-w-0 flex-1 truncate font-mono text-[10px] text-[var(--color-text-muted)]">
                          {`${MEDIA_BASE}/media/${id}/${f.id}`}
                        </code>
                        <CopyLink url={`${MEDIA_BASE}/media/${id}/${f.id}`} />
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {deleted.length > 0 ? (
            <section className="flex flex-col gap-3">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="font-mono text-xs uppercase tracking-wider text-[var(--color-text-subtle)]">
                  recently deleted ({deleted.length})
                </h3>
              </div>
              <p className="font-mono text-xs text-[var(--color-text-muted)]">
                deleted files can be restored within your plan&apos;s recovery window (7 / 30 / 90
                days).
              </p>
              <ul className="flex flex-col gap-2">
                {deleted.map((f) => (
                  <li
                    key={f.id}
                    className="flex flex-col gap-3 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-sm text-[var(--color-text)]">
                        {f.name}
                      </p>
                      <p className="mt-0.5 font-mono text-xs text-[var(--color-text-muted)]">
                        {formatBytes(Number(f.sizeBytes))}
                        {f.deletedAt ? ` · deleted ${timeAgo(f.deletedAt)}` : null}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <form action={restore}>
                        <input type="hidden" name="fileId" value={f.id} />
                        <button
                          type="submit"
                          className="rounded-md border border-[var(--color-border-subtle)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)]"
                        >
                          restore
                        </button>
                      </form>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <StorageKeysPanel
            projectId={id}
            endpoint={storageEndpoint || initialCreated?.endpoint || ''}
            initial={storageKeys}
            initialCreated={initialCreated}
          />
        </>
      )}
    </div>
  );
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'recently';
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MiB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GiB`;
}
