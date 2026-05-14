import { newId, NotFoundError, ValidationError } from '@briven/shared';
import { desc, eq, isNull } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import {
  incidentSeverity,
  incidents,
  type Incident,
  type IncidentSeverity,
} from '../db/schema.js';

/**
 * Operator-published platform incidents. Admin writes (create/update/
 * resolve) go through the admin router + step-up gate; public reads
 * power the /status page + RSS feed (separate consumer turn).
 */

// Service vocabulary kept in sync with what apps/realtime + status
// probes report. Adding a new service: append here, no migration needed.
const KNOWN_SERVICES = new Set(['api', 'realtime', 'runtime', 'web', 'docs', 'all']);

function validateServices(services: readonly string[]): void {
  if (services.length === 0) {
    throw new ValidationError('at least one affected service is required');
  }
  for (const s of services) {
    if (!KNOWN_SERVICES.has(s)) {
      throw new ValidationError(
        `unknown service "${s}". known: ${Array.from(KNOWN_SERVICES).join(', ')}`,
      );
    }
  }
}

function validateSeverity(severity: string): asserts severity is IncidentSeverity {
  if (!(incidentSeverity as readonly string[]).includes(severity)) {
    throw new ValidationError(
      `severity must be one of: ${incidentSeverity.join(', ')}`,
    );
  }
}

export async function listIncidents(opts: { limit?: number; activeOnly?: boolean } = {}): Promise<
  Incident[]
> {
  const db = getDb();
  if (opts.activeOnly) {
    return db
      .select()
      .from(incidents)
      .where(isNull(incidents.resolvedAt))
      .orderBy(desc(incidents.startedAt))
      .limit(opts.limit ?? 50);
  }
  return db
    .select()
    .from(incidents)
    .orderBy(desc(incidents.startedAt))
    .limit(opts.limit ?? 50);
}

export async function getIncident(id: string): Promise<Incident> {
  const db = getDb();
  const rows = await db.select().from(incidents).where(eq(incidents.id, id)).limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('incident', id);
  return row;
}

export interface CreateIncidentInput {
  startedAt?: Date;
  severity: string;
  services: readonly string[];
  summary: string;
  postmortem?: string;
  createdBy: string | null;
}

export async function createIncident(input: CreateIncidentInput): Promise<Incident> {
  validateSeverity(input.severity);
  validateServices(input.services);
  const summary = input.summary.trim();
  if (summary.length === 0 || summary.length > 2000) {
    throw new ValidationError('summary must be 1-2000 chars');
  }
  const postmortem = (input.postmortem ?? '').trim();
  if (postmortem.length > 20_000) {
    throw new ValidationError('postmortem cannot exceed 20kB');
  }
  const db = getDb();
  const inserted = await db
    .insert(incidents)
    .values({
      id: `inc_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}_${newId('ev').slice(-6)}`,
      startedAt: input.startedAt ?? new Date(),
      severity: input.severity,
      services: input.services,
      summary,
      postmortem,
      createdBy: input.createdBy,
    })
    .returning();
  const row = inserted[0];
  if (!row) throw new Error('insert returned no row');
  return row;
}

export interface UpdateIncidentInput {
  summary?: string;
  postmortem?: string;
  severity?: string;
  services?: readonly string[];
}

export async function updateIncident(
  id: string,
  patch: UpdateIncidentInput,
): Promise<Incident> {
  // Load + validate first so we 404 fast on missing rows.
  await getIncident(id);
  const updates: Partial<Incident> = { updatedAt: new Date() };
  if (patch.summary !== undefined) {
    const s = patch.summary.trim();
    if (s.length === 0 || s.length > 2000) {
      throw new ValidationError('summary must be 1-2000 chars');
    }
    updates.summary = s;
  }
  if (patch.postmortem !== undefined) {
    const p = patch.postmortem.trim();
    if (p.length > 20_000) {
      throw new ValidationError('postmortem cannot exceed 20kB');
    }
    updates.postmortem = p;
  }
  if (patch.severity !== undefined) {
    validateSeverity(patch.severity);
    updates.severity = patch.severity;
  }
  if (patch.services !== undefined) {
    validateServices(patch.services);
    updates.services = patch.services;
  }

  const db = getDb();
  const result = await db
    .update(incidents)
    .set(updates)
    .where(eq(incidents.id, id))
    .returning();
  if (!result[0]) throw new NotFoundError('incident', id);
  return result[0];
}

/**
 * Mark an incident resolved. Idempotent — calling resolve on an
 * already-resolved incident is a no-op (preserves the original
 * resolvedAt). Set `resolvedAt: null` via `updateIncident` if you need
 * to re-open one.
 */
export async function resolveIncident(id: string): Promise<Incident> {
  const existing = await getIncident(id);
  if (existing.resolvedAt) return existing;
  const db = getDb();
  const result = await db
    .update(incidents)
    .set({ resolvedAt: new Date(), updatedAt: new Date() })
    .where(eq(incidents.id, id))
    .returning();
  if (!result[0]) throw new NotFoundError('incident', id);
  return result[0];
}
