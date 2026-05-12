import { SqlEditor } from './sql-editor';

export const metadata = { title: 'studio · sql' };
export const dynamic = 'force-dynamic';

export default async function StudioSqlPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <section className="flex flex-col gap-4">
      <header>
        <h2 className="font-mono text-lg tracking-tight">sql editor</h2>
        <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
          run any postgres statement against this project&apos;s schema. scoped to the
          project owner role — you can only touch your own tables. 5 second statement
          timeout. every query is audit-logged.
        </p>
      </header>
      <SqlEditor projectId={id} />
    </section>
  );
}
