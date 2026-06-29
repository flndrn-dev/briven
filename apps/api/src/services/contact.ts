import { newId, ValidationError } from '@briven/shared';

import { getDb } from '../db/client.js';
import { contactMessages, contactTopics, type ContactTopic } from '../db/schema.js';
import { generateTicketNumber, primaryTopicCode } from './support-tickets.js';

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

export interface CreateContactMessageResult {
  /** The contact message id (ctc_<ULID>) — the public reference id. */
  id: string;
  /**
   * The human ticket number WITHOUT the leading '#' (e.g. SUP260629-000001),
   * or null when the submission carried no routing tag (stays a plain
   * contact message). The route renders it with the '#'.
   */
  ticketNumber: string | null;
}

/**
 * Insert a public contact-form submission. Mirrors createMigrationRequest:
 * validates + caps each field, generates a prefixed ULID, and returns the
 * new id (which the caller surfaces to the visitor as a reference). The
 * stored email is for the operator to reply privately — never echoed back
 * to the website.
 *
 * Ticketing: when the subject carries a routing tag
 * (#support/#billing/#technical/#self-hosting) the row becomes a support
 * ticket — the primary tag's code (SUP/BIL/TEC/SLF) is stamped, a daily
 * per-code ticket_number is allocated, and status starts at 'no_response'.
 * The number allocation + the row insert run in ONE transaction so a
 * generated counter is never wasted or duplicated on a failed insert.
 */
export async function createContactMessage(
  input: CreateContactMessageInput,
): Promise<CreateContactMessageResult> {
  const name = trimWithCap(input.name, NAME_CAP, 'name');
  if (!name) throw new ValidationError('name is required');
  const email = (input.email ?? '').trim();
  if (!email) throw new ValidationError('email is required');
  assertEmail(email);
  assertTopic(input.topic);
  // Capture the narrowed topic in a const — the assertion narrows the
  // mutable `input.topic` property, but that narrowing is lost inside the
  // transaction closure below, so hold it in a local that stays typed.
  const topic: ContactTopic = input.topic;
  const message = trimWithCap(input.message, MESSAGE_CAP, 'message');
  if (!message) throw new ValidationError('message is required');
  // Optional fields — cap + normalise empties to null so we never store
  // an empty string for "no subject" / "country unknown".
  const subjectTrimmed = trimWithCap(input.subject, SUBJECT_CAP, 'subject');
  const subject = subjectTrimmed.length > 0 ? subjectTrimmed : null;
  const countryTrimmed = trimWithCap(input.country, COUNTRY_CAP, 'country');
  const country = countryTrimmed.length > 0 ? countryTrimmed : null;

  const db = getDb();
  const topicCode = primaryTopicCode(subject);

  // Non-ticket path — plain contact message, current behavior.
  if (!topicCode) {
    const [row] = await db
      .insert(contactMessages)
      .values({
        id: newId('ctc'),
        name,
        email,
        topic,
        subject,
        message,
        country,
        ipHash: input.ipHash ?? null,
        userAgent: input.userAgent ?? null,
      })
      .returning({ id: contactMessages.id });
    if (!row) throw new Error('insert returned no row');
    return { id: row.id, ticketNumber: null };
  }

  // Ticket path — allocate the number + insert the row in ONE transaction.
  const now = new Date();
  return db.transaction(async (tx) => {
    const ticketNumber = await generateTicketNumber(topicCode, now, tx);
    const [row] = await tx
      .insert(contactMessages)
      .values({
        id: newId('ctc'),
        name,
        email,
        topic,
        subject,
        message,
        country,
        ipHash: input.ipHash ?? null,
        userAgent: input.userAgent ?? null,
        status: 'no_response',
        ticketNumber,
        topicCode,
      })
      .returning({ id: contactMessages.id });
    if (!row) throw new Error('insert returned no row');
    return { id: row.id, ticketNumber };
  });
}
