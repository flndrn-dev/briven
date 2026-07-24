import { AuthMigrationClient } from '../../migration/migration-client';

export const metadata = { title: 'Auth · import users' };
export const dynamic = 'force-dynamic';

export default async function AuthProjectMigrationPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return (
    <section>
      <header className="mb-6">
        <h2 className="font-mono text-lg tracking-tight text-[var(--color-text)]">
          import users
        </h2>
        <p className="mt-1 font-mono text-sm text-[var(--color-text-muted)]">
          move people from SuperTokens, Clerk, or another auth into this project
        </p>
      </header>
      <AuthMigrationClient projectId={projectId} />
    </section>
  );
}
