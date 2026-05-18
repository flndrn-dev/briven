import { describe, expect, it } from 'bun:test';

import { SubscriptionRegistry } from './subscription-registry.js';

describe('SubscriptionRegistry — Phase 1 §1.1 ref-counting invariants', () => {
  it('add → add same → remove → remove same → empty', () => {
    const r = new SubscriptionRegistry();

    // First attach to an empty channel returns true so the caller knows
    // to issue LISTEN exactly once per channel.
    expect(r.attach('s1', 'c1')).toBe(true);
    expect(r.hasChannel('c1')).toBe(true);
    expect(r.channelCount).toBe(1);

    // Idempotent attach — same sub, same channel — returns false because
    // the channel is no longer empty. Set semantics mean no duplicate entry.
    expect(r.attach('s1', 'c1')).toBe(false);
    expect(r.subsForChannel('c1')).toEqual(['s1']);
    expect(r.channelCount).toBe(1);

    // Last detach drains the set → returns true → caller issues UNLISTEN.
    expect(r.detach('s1', 'c1')).toBe(true);
    expect(r.hasChannel('c1')).toBe(false);
    expect(r.channelCount).toBe(0);

    // Detach the same sub again from the same (now-gone) channel: no-op,
    // returns false. Caller must not double-UNLISTEN.
    expect(r.detach('s1', 'c1')).toBe(false);
    expect(r.channelCount).toBe(0);
    expect(r.subsForChannel('c1')).toEqual([]);
  });

  it('multiple subs on a channel: only first attach and last detach return true', () => {
    const r = new SubscriptionRegistry();

    expect(r.attach('s1', 'c1')).toBe(true); // first → LISTEN
    expect(r.attach('s2', 'c1')).toBe(false); // ref + 1
    expect(r.attach('s3', 'c1')).toBe(false); // ref + 1

    expect(r.subsForChannel('c1').slice().sort()).toEqual(['s1', 's2', 's3']);

    expect(r.detach('s2', 'c1')).toBe(false); // ref - 1, still has subs
    expect(r.detach('s1', 'c1')).toBe(false); // ref - 1, still has subs
    expect(r.detach('s3', 'c1')).toBe(true); // last → UNLISTEN
    expect(r.hasChannel('c1')).toBe(false);
  });

  it('detach of unknown sub is a no-op false', () => {
    const r = new SubscriptionRegistry();
    r.attach('s1', 'c1');
    expect(r.detach('s-bogus', 'c1')).toBe(false);
    expect(r.subsForChannel('c1')).toEqual(['s1']);
  });

  it('subsForChannel returns a snapshot — mutation during iteration is safe', () => {
    const r = new SubscriptionRegistry();
    r.attach('s1', 'c1');
    r.attach('s2', 'c1');
    const snap = r.subsForChannel('c1');
    r.detach('s1', 'c1');
    expect(snap.slice().sort()).toEqual(['s1', 's2']);
    expect(r.subsForChannel('c1')).toEqual(['s2']);
  });
});
