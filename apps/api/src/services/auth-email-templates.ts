/**
 * Email template customization — Phase 7.5.
 *
 * Per-tenant overrides for transactional emails.  Templates support
 * simple {{variable}} substitution.  When a custom template is active,
 * it replaces the default briven template in the mailer pipeline.
 */

import { ValidationError } from '@briven/shared';
import { runInProjectDatabase } from '../db/data-plane.js';

export const EMAIL_TEMPLATE_NAMES = [
  'verification',
  'magic-link',
  'otp',
  'password-reset',
] as const;
export type EmailTemplateName = (typeof EMAIL_TEMPLATE_NAMES)[number];

export interface EmailTemplateInput {
  name: EmailTemplateName;
  subject: string;
  html: string;
  text?: string | null;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string | null;
}

export async function getEmailTemplate(
  projectId: string,
  name: EmailTemplateName,
): Promise<{ subject: string; html: string; text: string | null } | null> {
  const rows = await runInProjectDatabase(projectId, async (tx) => {
    return (await tx.unsafe(
      `SELECT subject, html, text FROM "_briven_auth_email_templates" WHERE name = $1 AND active = true LIMIT 1`,
      [name] as never,
    )) as Array<{ subject: string; html: string; text: string | null }>;
  });
  return rows[0] ?? null;
}

export async function setEmailTemplate(
  projectId: string,
  input: EmailTemplateInput,
): Promise<void> {
  if (!EMAIL_TEMPLATE_NAMES.includes(input.name)) {
    throw new ValidationError(`unknown template name: ${input.name}`);
  }
  const id = crypto.randomUUID();
  await runInProjectDatabase(projectId, async (tx) => {
    await tx.unsafe(
      `INSERT INTO "_briven_auth_email_templates" (id, name, subject, html, text)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (name) DO UPDATE SET
         subject = $3, html = $4, text = $5, active = true, updated_at = now()`,
      [id, input.name, input.subject, input.html, input.text ?? null] as never,
    );
  });
}

export async function deactivateEmailTemplate(projectId: string, name: EmailTemplateName): Promise<void> {
  await runInProjectDatabase(projectId, async (tx) => {
    await tx.unsafe(
      `UPDATE "_briven_auth_email_templates" SET active = false, updated_at = now() WHERE name = $1`,
      [name] as never,
    );
  });
}

export async function listEmailTemplates(
  projectId: string,
): Promise<Array<{ name: string; subject: string; active: boolean; updatedAt: Date }>> {
  const rows = await runInProjectDatabase(projectId, async (tx) => {
    return (await tx.unsafe(
      `SELECT name, subject, active, updated_at FROM "_briven_auth_email_templates" ORDER BY name`,
    )) as Array<{ name: string; subject: string; active: boolean; updated_at: Date }>;
  });
  return rows.map((r) => ({ name: r.name, subject: r.subject, active: r.active, updatedAt: r.updated_at }));
}

/**
 * Simple variable substitution: {{key}} → value.
 * Falls back to the default template when no custom template exists.
 */
export function renderTemplate(
  template: { subject: string; html: string; text: string | null },
  vars: Record<string, string>,
): RenderedEmail {
  let subject = template.subject;
  let html = template.html;
  let text = template.text;

  for (const [key, value] of Object.entries(vars)) {
    const placeholder = new RegExp(`\\{\\{\\s*${escapeRegExp(key)}\\s*\\}\\}`, 'g');
    subject = subject.replace(placeholder, value);
    html = html.replace(placeholder, escapeHtml(value));
    if (text) text = text.replace(placeholder, value);
  }

  return { subject, html, text: text ?? null };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
