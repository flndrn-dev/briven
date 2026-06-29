import { newId, NotFoundError, ValidationError } from '@briven/shared';
import { and, asc, desc, eq, isNotNull, sql } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import {
  contactMessageReplies,
  contactMessages,
  ticketReplyAuthors,
  ticketStatuses,
  type ContactMessage,
  type ContactMessageReply,
  type TicketReplyAuthor,
  type TicketStatus,
  type TicketTopicCode,
} from '../db/schema.js';

const NOTES_CAP = 20_000;
const REPLY_CAP = 8_000;
const ASSIGNEE_CAP = 200;

/**
 * The four routing tags the support form serializes into `subject` as
 * `#support #billing #technical #self-hosting`, mapped to their 3-letter
 * topic codes. A submission becomes a ticket when ≥1 of these is present;
 * the primary code is the FIRST one that appears in the subject string.
 */
export const TICKET_TAG_TO_CODE = {
  support: 'SUP',
  billing: 'BIL',
  technical: 'TEC',
  'self-hosting': 'SLF',
} as const;
export type RoutingTag = keyof typeof TICKET_TAG_TO_CODE;

/**
 * Pull the routing tags out of a serialized subject line, in the order
 * they appear. Pure + DB-free — the unit-tested seam. Recognises `#tag`
 * tokens; ignores any non-routing chips and de-dupes.
 */
export function parseRoutingTags(subject: string | null | undefined): RoutingTag[] {
  if (!subject) return [];
  const out: RoutingTag[] = [];
  const seen = new Set<RoutingTag>();
  const re = /#([a-z-]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(subject)) !== null) {
    const tag = m[1]!.toLowerCase();
    if (tag in TICKET_TAG_TO_CODE && !seen.has(tag as RoutingTag)) {
      seen.add(tag as RoutingTag);
      out.push(tag as RoutingTag);
    }
  }
  return out;
}

/**
 * Primary topic code for a subject, or null when no routing tag is present
 * (→ it stays a plain contact message, no ticket). The code is taken from
 * the FIRST routing tag in the subject.
 */
export function primaryTopicCode(subject: string | null | undefined): TicketTopicCode | null {
  const tags = parseRoutingTags(subject);
  return tags.length ? TICKET_TAG_TO_CODE[tags[0]!] : null;
}

/** UTC calendar-day key ('YYYY-MM-DD') the counter resets on. */
export function ticketDayKey(now: Date): string {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Format a ticket number from its parts — WITHOUT the leading '#'
 * (that's added only at the API/render edge). Shape:
 * `<CODE><YYMMDD>-<6-digit counter>` e.g. `SUP260629-000001`. Pure +
 * DB-free — the unit-tested seam for the format. Uses UTC so the day
 * stamp matches the counter's UTC day key.
 */
export function formatTicketNumber(code: string, now: Date, counter: number): string {
  const yy = String(now.getUTCFullYear()).slice(-2);
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const seq = String(counter).padStart(6, '0');
  return `${code}${yy}${mm}${dd}-${seq}`;
}

/** Render a stored ticket number for API responses (adds the '#'). */
export function renderTicketNumber(stored: string | null): string | null {
  return stored ? `#${stored}` : null;
}

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Atomically allocate the next ticket number for (topicCode, today) and
 * return the formatted value (no leading '#'). Race-safe: the
 * INSERT ... ON CONFLICT DO UPDATE bumps the per-day counter under the row
 * lock Postgres takes on the conflicting PK, so two concurrent creations
 * get distinct, gap-free numbers without any advisory lock. Pass the
 * enclosing transaction (`exec`) so the counter and the ticket insert
 * commit together — a number is never burned on a failed insert. `now` is
 * passed in (never read at module load) so callers/tests control the clock.
 */
export async function generateTicketNumber(
  topicCode: TicketTopicCode,
  now: Date = new Date(),
  exec: Db | Tx = getDb(),
): Promise<string> {
  const day = ticketDayKey(now);
  const rows = (await exec.execute(sql`
    INSERT INTO ticket_counters (topic_code, day, counter)
    VALUES (${topicCode}, ${day}, 1)
    ON CONFLICT (topic_code, day)
    DO UPDATE SET counter = ticket_counters.counter + 1
    RETURNING counter
  `)) as unknown as Array<{ counter: number }>;
  const counter = Number(rows[0]?.counter ?? 1);
  return formatTicketNumber(topicCode, now, counter);
}

/* ─── admin reads / writes ───────────────────────────────────────── */

export async function listTicketsForAdmin(
  opts: { status?: TicketStatus; limit?: number } = {},
): Promise<ContactMessage[]> {
  const db = getDb();
  const limit = Math.min(200, Math.max(1, opts.limit ?? 100));
  const conds = [isNotNull(contactMessages.ticketNumber)];
  if (opts.status) conds.push(eq(contactMessages.status, opts.status));
  return db
    .select()
    .from(contactMessages)
    .where(and(...conds))
    .orderBy(desc(contactMessages.createdAt))
    .limit(limit);
}

export async function getTicketByIdForAdmin(
  id: string,
): Promise<{ ticket: ContactMessage; replies: ContactMessageReply[] }> {
  const db = getDb();
  const rows = await db
    .select()
    .from(contactMessages)
    .where(and(eq(contactMessages.id, id), isNotNull(contactMessages.ticketNumber)))
    .limit(1);
  const ticket = rows[0];
  if (!ticket) throw new NotFoundError('ticket', id);
  const replies = await db
    .select()
    .from(contactMessageReplies)
    .where(eq(contactMessageReplies.messageId, id))
    .orderBy(asc(contactMessageReplies.createdAt));
  return { ticket, replies };
}

export interface UpdateTicketInput {
  status?: string;
  assignedTo?: string | null;
  operatorNotes?: string | null;
}

function assertStatus(s: string): asserts s is TicketStatus {
  if (!(ticketStatuses as readonly string[]).includes(s)) {
    throw new ValidationError(`status must be one of: ${ticketStatuses.join(', ')}`);
  }
}

export async function updateTicket(
  id: string,
  input: UpdateTicketInput,
): Promise<ContactMessage> {
  const patch: {
    status?: TicketStatus;
    assignedTo?: string | null;
    operatorNotes?: string | null;
  } = {};
  if (input.status !== undefined) {
    assertStatus(input.status);
    patch.status = input.status;
  }
  if (input.assignedTo !== undefined) {
    const v = (input.assignedTo ?? '').trim();
    if (v.length > ASSIGNEE_CAP) {
      throw new ValidationError(`assignedTo exceeds ${ASSIGNEE_CAP}-character cap`);
    }
    patch.assignedTo = v === '' ? null : v;
  }
  if (input.operatorNotes !== undefined) {
    const v = (input.operatorNotes ?? '').trim();
    if (v.length > NOTES_CAP) {
      throw new ValidationError(`operatorNotes exceeds ${NOTES_CAP}-character cap`);
    }
    patch.operatorNotes = v === '' ? null : v;
  }

  const db = getDb();
  // Scope the update to ticketed rows so a non-ticket contact id can never
  // be promoted into the ticket workflow via this endpoint.
  const [row] = await db
    .update(contactMessages)
    .set(patch)
    .where(and(eq(contactMessages.id, id), isNotNull(contactMessages.ticketNumber)))
    .returning();
  if (!row) throw new NotFoundError('ticket', id);
  return row;
}

/**
 * Append an operator reply to a ticket thread and return the new reply row
 * plus the parent ticket (so the caller has the sender's email to notify).
 * Validates the ticket exists + is ticketed first.
 */
export async function addReply(
  id: string,
  author: TicketReplyAuthor,
  body: string,
): Promise<{ reply: ContactMessageReply; ticket: ContactMessage }> {
  if (!(ticketReplyAuthors as readonly string[]).includes(author)) {
    throw new ValidationError('invalid reply author');
  }
  const trimmed = body.trim();
  if (!trimmed) throw new ValidationError('reply body is required');
  if (trimmed.length > REPLY_CAP) {
    throw new ValidationError(`reply body exceeds ${REPLY_CAP}-character cap`);
  }
  const db = getDb();
  const rows = await db
    .select()
    .from(contactMessages)
    .where(and(eq(contactMessages.id, id), isNotNull(contactMessages.ticketNumber)))
    .limit(1);
  const ticket = rows[0];
  if (!ticket) throw new NotFoundError('ticket', id);
  const [reply] = await db
    .insert(contactMessageReplies)
    .values({ id: newId('crp'), messageId: id, author, body: trimmed })
    .returning();
  if (!reply) throw new Error('insert returned no row');
  return { reply, ticket };
}

/* ─── user (dashboard) reads ─────────────────────────────────────── */

export async function listTicketsForUserEmail(
  email: string,
  opts: { limit?: number } = {},
): Promise<ContactMessage[]> {
  const db = getDb();
  const limit = Math.min(100, Math.max(1, opts.limit ?? 50));
  // Match case-insensitively: contact_messages.email is stored as submitted
  // (trimmed, not lowercased), while the session user's email is lowercased.
  return db
    .select()
    .from(contactMessages)
    .where(
      and(
        isNotNull(contactMessages.ticketNumber),
        sql`lower(${contactMessages.email}) = ${email.toLowerCase()}`,
      ),
    )
    .orderBy(desc(contactMessages.createdAt))
    .limit(limit);
}

/**
 * One ticket (by its human ticket number, with or without the leading '#'),
 * scoped to the owner's email. Returns null when it doesn't exist OR belongs
 * to someone else — same shape so the endpoint never leaks existence.
 */
export async function getTicketForUserByNumber(
  email: string,
  ticketNumber: string,
): Promise<{ ticket: ContactMessage; replies: ContactMessageReply[] } | null> {
  const stored = ticketNumber.trim().replace(/^#/, '');
  if (!stored) return null;
  const db = getDb();
  const rows = await db
    .select()
    .from(contactMessages)
    .where(
      and(
        eq(contactMessages.ticketNumber, stored),
        sql`lower(${contactMessages.email}) = ${email.toLowerCase()}`,
      ),
    )
    .limit(1);
  const ticket = rows[0];
  if (!ticket) return null;
  const replies = await db
    .select()
    .from(contactMessageReplies)
    .where(eq(contactMessageReplies.messageId, ticket.id))
    .orderBy(asc(contactMessageReplies.createdAt));
  return { ticket, replies };
}
