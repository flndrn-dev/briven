import { apiOrigin } from '../../../../../../lib/env';
import { ServiceBadgesPanel } from './service-badges-panel';

export const metadata = { title: 'service badges' };
export const dynamic = 'force-dynamic';

export default async function ServiceBadgesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="font-mono text-lg tracking-tight">service badges</h2>
        <p className="mt-1 max-w-2xl font-mono text-xs text-[var(--color-text-muted)]">
          each badge is a pass for <strong className="text-[var(--color-text)]">one room only</strong>{' '}
          inside this project: database, S3 storage, or Auth machines. a database badge cannot open
          storage or auth. secrets are shown once — copy them, then store them safely.
        </p>
      </header>
      <ServiceBadgesPanel apiOrigin={apiOrigin} projectId={id} />
    </div>
  );
}
