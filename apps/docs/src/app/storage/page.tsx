import { DocsShell } from '../../components/shell';

export const metadata = { title: 'storage' };

export default function StoragePage() {
  return (
    <DocsShell>
      <h1 className="font-mono text-2xl tracking-tight">storage (S3)</h1>
      <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
        per-project private buckets on briven MinIO. this is <strong className="text-[var(--color-text)]">file</strong>{' '}
        storage for your app — not the SQL database (that is{' '}
        <a className="underline" href="/doltgres">
          Doltgres
        </a>
        ) and not platform disaster-recovery backups.
      </p>

      <div className="mt-6 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 font-mono text-xs text-[var(--color-text-muted)]">
        <strong className="text-[var(--color-text)]">three different “keys”.</strong> auth uses{' '}
        <code>pk_briven_auth_…</code>. server data uses <code>brk_…</code>. storage uses{' '}
        <code>brvn…</code> access keys for one bucket only. never mix them.
      </div>

      <h2 className="mt-12 font-mono text-lg">what you get</h2>
      <ul className="mt-3 list-disc pl-5 font-mono text-sm text-[var(--color-text-muted)] space-y-2">
        <li>
          endpoint: <code>https://s3.briven.tech</code>
        </li>
        <li>
          bucket: <code>proj-…</code> (one per project)
        </li>
        <li>scoped S3 keys from the dashboard (secret shown once)</li>
        <li>
          public files at <code>https://media.briven.tech/media/&lt;projectId&gt;/&lt;fileId&gt;</code>
        </li>
        <li>soft-delete + restore (dashboard Recently deleted, or MCP restore tools)</li>
        <li>image resize URLs (imgproxy) when configured</li>
      </ul>

      <h2 className="mt-12 font-mono text-lg">dashboard</h2>
      <ol className="mt-3 list-decimal pl-5 font-mono text-sm text-[var(--color-text-muted)] space-y-2">
        <li>
          open{' '}
          <a className="underline" href="https://briven.tech">
            briven.tech
          </a>{' '}
          → your project → <em>Storage</em>
        </li>
        <li>
          create a key → copy endpoint, bucket, access key, secret immediately
        </li>
        <li>put them in your app server env (never in the browser for secret keys)</li>
      </ol>

      <h2 className="mt-12 font-mono text-lg">cli</h2>
      <p className="mt-3 font-mono text-sm text-[var(--color-text-muted)]">
        <code>briven setup</code> (new project) and <code>briven connect</code> (existing) always
        mint a project S3 key into <code>.env.local</code> when possible. see{' '}
        <a className="underline" href="/connect">
          connect
        </a>
        .
      </p>

      <h2 className="mt-12 font-mono text-lg">mcp</h2>
      <p className="mt-3 font-mono text-sm text-[var(--color-text-muted)]">
        with a project MCP key: <code>storage_upload_url</code>, <code>storage_list_files</code>,{' '}
        <code>storage_delete_file</code>, <code>storage_list_deleted</code>,{' '}
        <code>storage_restore_file</code>, <code>storage_mint_key</code>, and related tools. all
        scoped to <em>this</em> project only.
      </p>

      <h2 className="mt-12 font-mono text-lg">security</h2>
      <ul className="mt-3 list-disc pl-5 font-mono text-sm text-[var(--color-text-muted)] space-y-2">
        <li>a project key cannot list another project&apos;s bucket (isolation)</li>
        <li>prefer presigned upload URLs from the browser instead of proxying bytes</li>
        <li>revoke keys that leaked in chat or screenshots</li>
      </ul>
    </DocsShell>
  );
}
