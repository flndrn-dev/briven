import { brivenError } from '@briven/shared';

import { getTemplate } from '../templates/index.js';

import { createTable, insertRow } from './studio.js';

export interface SeedTemplateResult {
  readonly templateId: string;
  readonly tablesCreated: number;
  readonly rowsInserted: number;
}

/**
 * Stand up a starter template inside an already-provisioned project: create
 * each table (in FK order) then seed its sample rows. Uses the same studio
 * services the UI uses, so every identifier + value is schema-validated and
 * the result is indistinguishable from a user who built it by hand.
 *
 * Not transactional across tables — each createTable/insertRow is its own
 * statement. A template is fixed, validated data (not user input), so partial
 * failure should not happen in practice; if it does, the caller surfaces the
 * error and the half-seeded project can be deleted + recreated.
 */
export async function seedTemplate(
  projectId: string,
  templateId: string,
): Promise<SeedTemplateResult> {
  const tpl = getTemplate(templateId);
  if (!tpl) {
    throw new brivenError('not_found', `unknown template: ${templateId}`, { status: 404 });
  }

  let tablesCreated = 0;
  let rowsInserted = 0;

  for (const table of tpl.tables) {
    await createTable({
      projectId,
      tableName: table.tableName,
      columns: table.columns,
    });
    tablesCreated++;

    for (const values of table.rows ?? []) {
      await insertRow({ projectId, tableName: table.tableName, values });
      rowsInserted++;
    }
  }

  return { templateId: tpl.id, tablesCreated, rowsInserted };
}
