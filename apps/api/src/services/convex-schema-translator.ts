import { ValidationError } from '@briven/shared';

/**
 * Convex schema → briven schema DSL translator (offline; no convex
 * deployment required). Accepts the literal TypeScript source of the
 * customer's convex/schema.ts (paste-in flow from the admin row) and
 * emits a draft briven/schema.ts the operator reviews before shipping.
 *
 * Scope today: defineTable() with v.string/number/int64/boolean/id/
 * optional. union-of-literal types fall through to text() + a TODO
 * comment so the operator picks the validation approach. Indexes parse
 * but become inline TODOs in the briven schema (we don't have a
 * stable enough indexes-on-table DSL output yet).
 *
 * Errors: ValidationError on completely unparseable input. Warnings
 * collected per-table for the operator to read.
 */

const INPUT_CAP = 100_000;

export interface TranslationResult {
  brivenSchema: string;
  warnings: readonly string[];
  tables: ReadonlyArray<{ name: string; columns: number }>;
}

export function translateConvexSchema(source: string): TranslationResult {
  if (!source || typeof source !== 'string') {
    throw new ValidationError('schema source is required');
  }
  if (source.length > INPUT_CAP) {
    throw new ValidationError(`schema source exceeds ${INPUT_CAP}-character cap`);
  }

  const warnings: string[] = [];
  const tables: { name: string; columns: number }[] = [];

  // Strip TS comments (line + block) so the parser doesn't trip on
  // // defineTable references inside comments. Crude but reliable.
  const cleaned = source
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  // Find every `<key>: defineTable({ ... })` block. We don't try to
  // parse a full TS AST — a balanced-brace walk after the open is
  // enough for the patterns convex users actually write.
  const tableRegex = /(\w+)\s*:\s*defineTable\s*\(\s*{/g;
  const lines: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = tableRegex.exec(cleaned)) !== null) {
    const tableName = match[1]!;
    const bodyStart = match.index + match[0].length;
    const bodyEnd = findMatchingBrace(cleaned, bodyStart);
    if (bodyEnd === -1) {
      warnings.push(
        `${tableName}: unbalanced braces in defineTable body — skipped. operator should hand-port this table.`,
      );
      continue;
    }
    const body = cleaned.slice(bodyStart, bodyEnd);
    const columns = parseColumns(body, tableName, warnings);
    tables.push({ name: tableName, columns: columns.length });
    lines.push(emitTable(tableName, columns));
  }

  if (tables.length === 0) {
    warnings.push(
      'no defineTable() calls found. paste only the schema.ts content (defineSchema + every defineTable).',
    );
  }

  const brivenSchema = renderSchemaFile(lines, tables);
  return { brivenSchema, warnings, tables };
}

interface ColumnDecl {
  name: string;
  brivenType: string;
  notNull: boolean;
  references?: string;
  todoComment?: string;
}

function findMatchingBrace(s: string, start: number): number {
  let depth = 1;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

const SIMPLE_TYPE_MAP: Record<string, string> = {
  'v.string()': 'text()',
  'v.number()': 'bigint()',
  'v.int64()': 'bigint()',
  'v.float64()': 'bigint()',
  'v.boolean()': 'boolean()',
  'v.bytes()': 'text()',
  'v.null()': 'text()',
  'v.any()': 'jsonb()',
};

function parseColumns(
  body: string,
  tableName: string,
  warnings: string[],
): ColumnDecl[] {
  // Match `name: <expr>` pairs at the top level of the object literal.
  // We walk the body char-by-char to handle nested parens/braces inside
  // each value expression.
  const cols: ColumnDecl[] = [];
  let i = 0;
  while (i < body.length) {
    // Skip whitespace and commas.
    while (i < body.length && /[\s,]/.test(body[i]!)) i++;
    if (i >= body.length) break;
    // Read name.
    const nameStart = i;
    while (i < body.length && /\w/.test(body[i]!)) i++;
    const name = body.slice(nameStart, i);
    if (!name) {
      i++;
      continue;
    }
    // Expect colon.
    while (i < body.length && /\s/.test(body[i]!)) i++;
    if (body[i] !== ':') {
      // Not a key:value — probably a `.index(...)` call hanging off
      // the closing brace. Bail.
      break;
    }
    i++;
    // Read value until top-level comma or end.
    const valueStart = i;
    let depth = 0;
    while (i < body.length) {
      const c = body[i]!;
      if (c === '(' || c === '{' || c === '[') depth++;
      else if (c === ')' || c === '}' || c === ']') depth--;
      else if (c === ',' && depth === 0) break;
      i++;
    }
    const valueExpr = body.slice(valueStart, i).trim();
    const col = translateColumn(name, valueExpr, tableName, warnings);
    if (col) cols.push(col);
  }
  return cols;
}

function translateColumn(
  name: string,
  expr: string,
  tableName: string,
  warnings: string[],
): ColumnDecl | null {
  let notNull = true;
  let working = expr;
  // Peel one layer of v.optional(...).
  const optMatch = /^v\.optional\s*\(\s*([\s\S]+)\s*\)$/.exec(working);
  if (optMatch) {
    notNull = false;
    working = optMatch[1]!.trim();
  }
  // v.id("users") → text().references("users", "id")
  const idMatch = /^v\.id\s*\(\s*['"]([^'"]+)['"]\s*\)$/.exec(working);
  if (idMatch) {
    return {
      name,
      brivenType: `text().references('${idMatch[1]}', 'id')`,
      notNull,
      references: idMatch[1],
    };
  }
  // Simple types.
  if (SIMPLE_TYPE_MAP[working]) {
    return { name, brivenType: SIMPLE_TYPE_MAP[working]!, notNull };
  }
  // Array / object — store as jsonb.
  if (working.startsWith('v.array(') || working.startsWith('v.object(')) {
    return {
      name,
      brivenType: 'jsonb()',
      notNull,
      todoComment: 'convex v.array/v.object → jsonb; refine to nested table if you query into it',
    };
  }
  // Union — usually v.union(v.literal("a"), v.literal("b")). Treat as
  // text() + a TODO. The narrower validation gets done in the function
  // layer with zod, mirroring the docs guidance.
  if (working.startsWith('v.union(')) {
    return {
      name,
      brivenType: 'text()',
      notNull,
      todoComment: 'convex v.union — validate this enum at the function layer with zod',
    };
  }
  warnings.push(
    `${tableName}.${name}: couldn't translate "${expr.slice(0, 60)}". emitting text() — review manually.`,
  );
  return {
    name,
    brivenType: 'text()',
    notNull,
    todoComment: `unrecognised convex type: ${expr.slice(0, 80)}`,
  };
}

function emitTable(name: string, columns: ColumnDecl[]): string {
  const colLines = columns
    .map((c) => {
      const todo = c.todoComment ? `      // TODO: ${c.todoComment}\n` : '';
      const notNull = c.notNull ? '.notNull()' : '';
      return `${todo}      ${c.name}: ${c.brivenType}${notNull},`;
    })
    .join('\n');
  return `  ${name}: table({
    columns: {
${colLines}
    },
  }),`;
}

function renderSchemaFile(
  tableLines: string[],
  tables: { name: string; columns: number }[],
): string {
  const header = `import { bigint, boolean, jsonb, schema, table, text } from '@briven/cli/schema';

// Generated from convex/schema.ts by the briven schema translator.
// Review every TODO before deploying. Convex's _creationTime is implicit
// in convex but explicit in briven — add createdAt: bigint().notNull()
// to tables that need it. Convex indexes (.index("by_x", ["x"])) move
// to a table-level \`indexes: [{ columns: ['x'] }]\` array; not yet
// auto-emitted by the translator.

`;
  const summary = `// translator summary: ${tables.length} table${tables.length === 1 ? '' : 's'} — ${tables.map((t) => `${t.name}(${t.columns})`).join(', ') || 'none'}.\n\n`;
  return `${header}${summary}export default schema({
${tableLines.join('\n\n')}
});
`;
}
