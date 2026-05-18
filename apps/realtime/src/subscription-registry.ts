/**
 * Ref-counted map of LISTEN channels to subscriber ids.
 *
 * Phase 1 §1.1: factored out of `index.ts` so the add/remove invariants
 * are unit-testable in isolation. The realtime service owns one of these
 * per process. Channel names are project- and table-scoped strings
 * (`briven_<schema>_<table>`) — the registry treats them as opaque keys.
 *
 * Semantics
 *   - `attach(subId, channel)`  → adds the sub to the channel's set;
 *                                 returns true iff this attach took the
 *                                 set from empty → non-empty (the caller
 *                                 uses that signal to issue `LISTEN`).
 *   - `detach(subId, channel)`  → removes the sub; returns true iff this
 *                                 detach drained the set (caller issues
 *                                 `UNLISTEN`). Detaching an unknown sub
 *                                 from a known channel is a no-op false.
 *   - Idempotency: attach is idempotent (Set semantics); detach is
 *     idempotent against an already-empty channel.
 *   - `subsForChannel` returns a snapshot — callers can mutate the
 *     registry while iterating without skipping or revisiting.
 */
export class SubscriptionRegistry {
  private channelToSubs = new Map<string, Set<string>>();

  attach(subId: string, channel: string): boolean {
    let set = this.channelToSubs.get(channel);
    if (!set) {
      set = new Set();
      this.channelToSubs.set(channel, set);
    }
    const wasEmpty = set.size === 0;
    set.add(subId);
    return wasEmpty;
  }

  detach(subId: string, channel: string): boolean {
    const set = this.channelToSubs.get(channel);
    if (!set) return false;
    if (!set.delete(subId)) return false;
    if (set.size === 0) {
      this.channelToSubs.delete(channel);
      return true;
    }
    return false;
  }

  subsForChannel(channel: string): readonly string[] {
    const set = this.channelToSubs.get(channel);
    return set ? [...set] : [];
  }

  hasChannel(channel: string): boolean {
    return this.channelToSubs.has(channel);
  }

  get channelCount(): number {
    return this.channelToSubs.size;
  }

  /** Snapshot of all channels and their current sub counts. Used by the
   *  `/v1/realtime/stats` operator endpoint; not on any hot path. */
  channelCounts(): { channel: string; subscriptions: number }[] {
    const out: { channel: string; subscriptions: number }[] = [];
    for (const [channel, set] of this.channelToSubs) {
      out.push({ channel, subscriptions: set.size });
    }
    return out;
  }
}
