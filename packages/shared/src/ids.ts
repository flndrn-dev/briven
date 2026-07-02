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
  | 'au' // usage event (aggregator row)
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
  | 'auk' // briven auth SDK key (issued from the Auth → API Keys panel)
  | 'as' // auto-snapshot settings row (per-project automatic save-points)
  | 'agt'; // platform agent (admin-registered AI agent, encrypted provider key)

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
