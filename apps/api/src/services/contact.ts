import { newId, ValidationError } from '@briven/shared';

import { getDb } from '../db/client.js';
import { contactMessages, contactTopics, type ContactTopic } from '../db/schema.js';

const NAME_CAP = 200;
const EMAIL_CAP = 320;
const SUBJECT_CAP = 200;
const COUNTRY_CAP = 100;
const MESSAGE_CAP = 8_000;

export interface CreateContactMessageInput {
  name: string;
  email: string;
  topic: string;
  /** Free-text "what's this about" line. Optional. */
  subject?: string | null;
  message: string;
  /** Visitor country auto-detected on /contact (locked field). Optional. */
  country?: string | null;
  ipHash?: string | null;
  userAgent?: string | null;
}

function assertTopic(t: string): asserts t is ContactTopic {
  if (!(contactTopics as readonly string[]).includes(t)) {
    throw new ValidationError(`topic must be one of: ${contactTopics.join(', ')}`);
  }
}

function trimWithCap(s: string | undefined | null, cap: number, field: string): string {
  const trimmed = (s ?? '').trim();
  if (trimmed.length > cap) {
    throw new ValidationError(`${field} exceeds ${cap}-character cap`);
  }
  return trimmed;
}

function assertEmail(email: string): void {
  if (email.length > EMAIL_CAP) {
    throw new ValidationError(`email exceeds ${EMAIL_CAP}-character cap`);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ValidationError('email is not a valid address');
  }
}

/**
 * Insert a public contact-form submission. Mirrors createMigrationRequest:
 * validates + caps each field, generates a prefixed ULID, and returns the
 * new id (which the caller surfaces to the visitor as a reference). The
 * stored email is for the operator to reply privately — never echoed back
 * to the website.
 */
export async function createContactMessage(
  input: CreateContactMessageInput,
): Promise<string> {
  const name = trimWithCap(input.name, NAME_CAP, 'name');
  if (!name) throw new ValidationError('name is required');
  const email = (input.email ?? '').trim();
  if (!email) throw new ValidationError('email is required');
  assertEmail(email);
  assertTopic(input.topic);
  const message = trimWithCap(input.message, MESSAGE_CAP, 'message');
  if (!message) throw new ValidationError('message is required');
  // Optional fields — cap + normalise empties to null so we never store
  // an empty string for "no subject" / "country unknown".
  const subjectTrimmed = trimWithCap(input.subject, SUBJECT_CAP, 'subject');
  const subject = subjectTrimmed.length > 0 ? subjectTrimmed : null;
  const countryTrimmed = trimWithCap(input.country, COUNTRY_CAP, 'country');
  const country = countryTrimmed.length > 0 ? countryTrimmed : null;

  const db = getDb();
  const [row] = await db
    .insert(contactMessages)
    .values({
      id: newId('ctc'),
      name,
      email,
      topic: input.topic,
      subject,
      message,
      country,
      ipHash: input.ipHash ?? null,
      userAgent: input.userAgent ?? null,
    })
    .returning({ id: contactMessages.id });
  if (!row) throw new Error('insert returned no row');
  return row.id;
}
