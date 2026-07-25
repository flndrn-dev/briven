import { notFound } from 'next/navigation';

import { fetchAuthUserDetail } from '../../../lib/auth-api';
import { UserManageClient } from './user-manage-client';

export const metadata = { title: 'Auth · user' };
export const dynamic = 'force-dynamic';

export default async function AuthUserDetailPage({
  params,
}: {
  params: Promise<{ projectId: string; userId: string }>;
}) {
  const { projectId, userId } = await params;
  const result = await fetchAuthUserDetail(userId, projectId);
  if (!result.ok) {
    if (result.status === 404) notFound();
    return (
      <section className="font-mono text-sm text-[var(--color-text-muted)]">
        {result.message || 'could not load user'}
      </section>
    );
  }

  return (
    <UserManageClient projectId={projectId} initialUser={result.user} />
  );
}
