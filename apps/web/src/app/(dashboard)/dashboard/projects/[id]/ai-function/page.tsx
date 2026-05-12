import { apiJson } from '../../../../../../lib/api';
import { AiFunctionForm } from './ai-function-form';

interface ColumnDef {
  sqlType: string;
  nullable: boolean;
  primaryKey: boolean;
  unique: boolean;
  default?: string;
  references?: { table: string; column: string };
}

interface TableDef {
  columns: Record<string, ColumnDef>;
  indexes: Array<{ columns: string[]; unique: boolean }>;
}

interface SchemaSnapshot {
  version: 1;
  tables: Record<string, TableDef>;
}

interface CurrentSchemaResponse {
  deploymentId: string | null;
  snapshot: SchemaSnapshot | null;
}

export const metadata = { title: 'ai function' };
export const dynamic = 'force-dynamic';

/**
 * Render the JSON snapshot as a compact TypeScript-flavoured summary the
 * model can read. The dashboard SSRs this so the client form receives
 * the already-formatted string and doesn't need a second round-trip.
 */
function snapshotToContext(snapshot: SchemaSnapshot): string {
  const lines: string[] = [];
  for (const [tableName, table] of Object.entries(snapshot.tables)) {
    const cols = Object.entries(table.columns)
      .map(([name, col]) => {
        const parts = [`${name}: ${col.sqlType}`];
        if (col.primaryKey) parts.push('PK');
        if (col.unique) parts.push('UNIQUE');
        if (!col.nullable) parts.push('NOT NULL');
        if (col.references) parts.push(`-> ${col.references.table}.${col.references.column}`);
        return `  ${parts.join(' ')}`;
      })
      .join('\n');
    lines.push(`table ${tableName} {\n${cols}\n}`);
  }
  return lines.join('\n\n');
}

export default async function AiFunctionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const current = await apiJson<CurrentSchemaResponse>(`/v1/projects/${id}/schema/current`).catch(
    () => null,
  );
  const schemaContext = current?.snapshot ? snapshotToContext(current.snapshot) : null;

  return (
    <section className="flex flex-col gap-6">
      <header>
        <h1 className="font-mono text-xl tracking-tight">ai function</h1>
        <p className="mt-1 font-mono text-sm text-[var(--color-text-muted)]">
          describe what a function should do. briven&apos;s AI assistant returns a draft{' '}
          <code>briven/functions/&lt;name&gt;.ts</code> file using your project&apos;s current
          schema as context.
        </p>
        <p className="mt-2 font-mono text-xs text-[var(--color-text-subtle)]">
          your prompt + (optional) schema context are sent to a self-hosted Qwen 2.5-coder model on
          briven infrastructure — not to any third-party AI provider. prompts and responses are not
          logged.
        </p>
      </header>

      <AiFunctionForm projectId={id} schemaContext={schemaContext} />
    </section>
  );
}
