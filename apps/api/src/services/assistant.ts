import { brivenError, ValidationError } from '@briven/shared';

import { ollamaChat } from './ollama.js';
import {
  createTable,
  getFullSchema,
  insertRow,
  STUDIO_COLUMN_TYPES,
  type StudioColumnSpec,
  type StudioColumnType,
} from './studio.js';

/**
 * Briven's in-product database assistant.
 *
 * Flow is deliberately two-step so a non-technical user is never surprised:
 *   1. planDatabase()  — ask Ollama for a JSON "build plan" (tables, columns,
 *      sample rows). NOTHING is written. The dashboard shows it for review.
 *   2. applyPlan()     — once the user clicks "build it", we run the plan
 *      through the SAME validated studio operations a human uses
 *      (createTable / insertRow). The model never touches the database;
 *      it only proposes, we execute through tested code.
 *
 * We always add the `id` (uuid pk) and `created_at` columns ourselves, so
 * every table is valid no matter what the model returns.
 */

export interface PlannedColumn {
  readonly name: string;
  readonly type: StudioColumnType;
  readonly notNull: boolean;
}

export interface PlannedTable {
  readonly name: string;
  readonly description: string;
  readonly columns: readonly PlannedColumn[];
  readonly sampleRows: ReadonlyArray<Record<string, unknown>>;
}

export interface AssistantPlan {
  readonly summary: string;
  readonly tables: readonly PlannedTable[];
}

export interface ApplyResult {
  readonly summary: string;
  readonly created: ReadonlyArray<{ table: string; columns: number; rows: number }>;
  readonly skipped: readonly string[];
}

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
const MAX_TABLES = 8;
const MAX_COLS = 30;
const MAX_SAMPLE_ROWS = 10;

/** Columns Briven adds itself — never accepted from the model. */
const RESERVED = new Set(['id', 'created_at', 'createdat']);

const SYSTEM_PROMPT = [
  "You are Briven's database design assistant for NON-TECHNICAL people.",
  'Turn the user\'s plain-English description into a simple, sensible database.',
  '',
  'Reply with STRICT JSON only — no prose, no markdown — in exactly this shape:',
  '{',
  '  "summary": "one friendly sentence describing what you designed",',
  '  "tables": [',
  '    {',
  '      "name": "snake_case_table_name",',
  '      "description": "short plain-English purpose",',
  '      "columns": [',
  '        { "name": "snake_case_column", "type": "text", "notNull": true }',
  '      ],',
  '      "sampleRows": [ { "snake_case_column": "an example value" } ]',
  '    }',
  '  ]',
  '}',
  '',
  `Allowed column "type" values ONLY: ${STUDIO_COLUMN_TYPES.join(', ')}.`,
  'Rules:',
  '- Use snake_case for every table and column name (letters, numbers, underscore).',
  '- Do NOT add an "id" or "created_at" column — Briven adds those automatically.',
  '- Keep each table to 3-6 meaningful columns. At most 6 tables.',
  '- Give every table 2-3 realistic sample rows (omit id/created_at).',
  '- For links between tables, add a column like "customer_id" of type "uuid".',
  '- Prefer "text" for names/notes, "integer" for counts, "numeric" for money,',
  '  "boolean" for yes/no, "timestamptz" for dates/times.',
].join('\n');

function asType(v: unknown): StudioColumnType | null {
  return typeof v === 'string' && (STUDIO_COLUMN_TYPES as readonly string[]).includes(v)
    ? (v as StudioColumnType)
    : null;
}

/**
 * Validate + normalise an untrusted plan object (from the model OR echoed
 * back by the client). Drops anything malformed rather than trusting it.
 * Throws a friendly ValidationError if nothing usable survives.
 */
export function normalizePlan(raw: unknown): AssistantPlan {
  const obj = (raw ?? {}) as { summary?: unknown; tables?: unknown };
  const summary = typeof obj.summary === 'string' ? obj.summary.slice(0, 400) : '';
  const rawTables = Array.isArray(obj.tables) ? obj.tables : [];
  const tables: PlannedTable[] = [];

  for (const t of rawTables.slice(0, MAX_TABLES)) {
    if (!t || typeof t !== 'object') continue;
    const tt = t as {
      name?: unknown;
      description?: unknown;
      columns?: unknown;
      sampleRows?: unknown;
    };
    const name = typeof tt.name === 'string' ? tt.name.trim().toLowerCase() : '';
    if (!NAME_RE.test(name) || name.startsWith('_briven_')) continue;

    const seen = new Set<string>();
    const columns: PlannedColumn[] = [];
    for (const c of Array.isArray(tt.columns) ? tt.columns.slice(0, MAX_COLS) : []) {
      if (!c || typeof c !== 'object') continue;
      const cc = c as { name?: unknown; type?: unknown; notNull?: unknown };
      const cname = typeof cc.name === 'string' ? cc.name.trim().toLowerCase() : '';
      const ctype = asType(cc.type);
      if (!NAME_RE.test(cname) || !ctype) continue;
      if (RESERVED.has(cname) || seen.has(cname)) continue;
      seen.add(cname);
      columns.push({ name: cname, type: ctype, notNull: cc.notNull === true });
    }
    if (columns.length === 0) continue;

    const colNames = new Set(columns.map((c) => c.name));
    const sampleRows: Record<string, unknown>[] = [];
    for (const r of Array.isArray(tt.sampleRows) ? tt.sampleRows.slice(0, MAX_SAMPLE_ROWS) : []) {
      if (!r || typeof r !== 'object') continue;
      const row: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(r as Record<string, unknown>)) {
        const key = k.trim().toLowerCase();
        if (colNames.has(key) && v !== undefined) row[key] = v;
      }
      if (Object.keys(row).length > 0) sampleRows.push(row);
    }

    tables.push({
      name,
      description: typeof tt.description === 'string' ? tt.description.slice(0, 200) : '',
      columns,
      sampleRows,
    });
  }

  if (tables.length === 0) {
    throw new ValidationError('the assistant could not turn that into a database — try rephrasing', {});
  }
  return { summary, tables };
}

/**
 * Ask the brain for a build plan. Read-only — writes nothing. The current
 * schema is passed as context so the model extends rather than collides.
 */
export async function planDatabase(projectId: string, prompt: string): Promise<AssistantPlan> {
  if (typeof prompt !== 'string' || prompt.trim() === '') {
    throw new ValidationError('describe what you want to track', {});
  }
  const schema = await getFullSchema(projectId);
  const existing = schema.tables.map((t) => t.name);
  const context =
    existing.length > 0
      ? `The project already has these tables (do not recreate them): ${existing.join(', ')}.`
      : 'The project is empty — this is the first design.';

  const content = await ollamaChat(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `${context}\n\nWhat the user wants:\n${prompt.slice(0, 2000)}` },
    ],
    { json: true, temperature: 0.2 },
  );

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new brivenError('assistant_bad_json', 'the assistant gave an answer we could not read — try again', {
      status: 502,
    });
  }
  return normalizePlan(parsed);
}

/**
 * Execute an (already reviewed) plan through the validated studio ops.
 * Each table gets an auto `id` (uuid pk) + `created_at`. Tables that already
 * exist are skipped, not overwritten. Sample-row failures are tolerated so
 * one bad value can't abort the whole build.
 */
export async function applyPlan(projectId: string, rawPlan: unknown): Promise<ApplyResult> {
  const plan = normalizePlan(rawPlan);
  const schema = await getFullSchema(projectId);
  const existing = new Set(schema.tables.map((t) => t.name));

  const created: Array<{ table: string; columns: number; rows: number }> = [];
  const skipped: string[] = [];

  for (const table of plan.tables) {
    if (existing.has(table.name)) {
      skipped.push(table.name);
      continue;
    }
    const columns: StudioColumnSpec[] = [
      { name: 'id', type: 'uuid', primaryKey: true, defaultExpr: 'gen_random_uuid()' },
      ...table.columns.map((c) => ({ name: c.name, type: c.type, notNull: c.notNull })),
      { name: 'created_at', type: 'timestamptz', notNull: true, defaultExpr: 'now()' },
    ];
    await createTable({ projectId, tableName: table.name, columns });
    existing.add(table.name);

    let rows = 0;
    for (const sample of table.sampleRows) {
      const values: Record<string, unknown> = {};
      for (const col of table.columns) {
        if (sample[col.name] !== undefined) values[col.name] = sample[col.name];
      }
      if (Object.keys(values).length === 0) continue;
      try {
        await insertRow({ projectId, tableName: table.name, values });
        rows += 1;
      } catch {
        // tolerate a single bad sample row; keep building
      }
    }
    created.push({ table: table.name, columns: columns.length, rows });
  }

  return { summary: plan.summary, created, skipped };
}
