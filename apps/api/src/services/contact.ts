import { newId, ValidationError } from '@briven/shared';

import { getDb } from '../db/client.js';
import { contactMessages, contactTopics, type ContactTopic } from '../db/schema.js';

const NAME_CAP = 200;
const EMAIL_CAP = 320;
const MESSAGE_CAP = 8_000;

export interface CreateContactMessageInput {
  name: string;
  email: string;
  topic: string;
  message: string;
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

  const db = getDb();
  const [row] = await db
    .insert(contactMessages)
    .values({
      id: newId('ctc'),
      name,
      email,
      topic: input.topic,
      message,
      ipHash: input.ipHash ?? null,
      userAgent: input.userAgent ?? null,
    })
    .returning({ id: contactMessages.id });
  if (!row) throw new Error('insert returned no row');
  return row.id;
}
