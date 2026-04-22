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
  | 'p' // project
  | 'd' // deployment
  | 'k' // api key
  | 'm' // member
  | 'au' // audit log
  | 'fn' // function record
  | 'ev' // event
  | 'inv'; // invocation — per-call id attached to function logs

export function newId(prefix: IdPrefix): string {
  return `${prefix}_${ulid()}`;
}

export function isId(value: unknown, prefix: IdPrefix): value is `${IdPrefix}_${string}` {
  return (
    typeof value === 'string' && value.startsWith(`${prefix}_`) && value.length === prefix.length + 27
  );
}
