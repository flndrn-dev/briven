import { ulid } from 'ulid';

/**
 * Prefixed ULID identifiers. Per CLAUDE.md §8.1 every meta-DB row uses a
 * ULID primary key; human-facing IDs additionally carry a two-or-three letter
 * prefix so they are self-describing in logs, URLs, and dashboards.
 *
 * @example
 *   const projectId = newId('p'); // "p_01HZ5E4..."
 */
export type IdPrefix =
  | 'u' // user
  | 'a' // account
  | 'org' // organisation
  | 'p' // project
  | 'd' // deployment
  | 'k' // api key
  | 'm' // member
  | 'au' // audit log
  | 'ar' // abuse report
  | 'fn' // function record
  | 'ev' // event
  | 'inv' // invocation — per-call id attached to function logs
  | 'iso' // isolate — per-process id used by the runtime pool
  | 'sup' // email suppression entry
  | 'dh' // deploy history entry
  | 'ue' // usage event (aggregator row)
  // NOTE: 'au' (above) is the audit-log prefix and stays as-is — it is the
  // natural fit and audit.ts already persists rows with it. The usage-event
  // row previously also used 'au' (a duplicate). New usage events should use
  // 'ue'; existing usage rows persisted with 'au_<ulid>' remain valid PKs
  // (ULIDs are globally unique regardless of prefix, and usage-event ids are
  // never validated by prefix), so no data migration is needed. The emitter
  // apps/api/src/workers/usage-aggregator.ts still calls newId('au') and
  // should be switched to newId('ue') in a coordinated apps-side change
  // (outside packages/* ownership).
  | 'br' // project branch (preview environment)
  | 'wf' // workflow definition
  | 'wfr' // workflow run
  | 'sch' // schedule (cron-triggered function invocation)
  | 'sr' // schedule run (per-fire audit record)
  | 'f' // file (project storage object)
  | 'whe' // webhook endpoint (customer-defined inbound webhook)
  | 'whd' // webhook delivery (per-incoming-request log row)
  | 'whs' // webhook subscriber (customer-defined outbound webhook target)
  | 'whod' // webhook outbound delivery (per-fanout attempt log row)
  | 'wev' // webhook event (an emitted platform event, fans out to N deliveries)
  | 'al' // allowlist entry (invite-only beta signup gate)
  | 'mig' // migration request (customer-initiated import from convex/supabase/etc.)
  | 'me' // marketing event (funnel tracking for /migrate views + leads)
  | 'ctc' // contact message (public /contact form submission)
  | 'crp' // contact message reply (operator/user thread message on a ticket)
  | 'auk' // briven auth SDK key (issued from the Auth → API Keys panel)
  | 'mck' // mcp / agent-access key (issued from the MCP control panel)
  | 'tsec' // tenant secret (per-project encrypted OAuth client secret)
  | 'as'; // auto-snapshot settings row (per-project automatic save-points)

export function newId(prefix: IdPrefix): string {
  return `${prefix}_${ulid()}`;
}

export function isId(value: unknown, prefix: IdPrefix): value is `${IdPrefix}_${string}` {
  return (
    typeof value === 'string' &&
    value.startsWith(`${prefix}_`) &&
    value.length === prefix.length + 27
  );
}
