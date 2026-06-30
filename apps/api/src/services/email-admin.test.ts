/**
 * Unit tests for the per-template stats join (Phase 8 §3). The DB-touching
 * wrapper (getEmailAdminSummary) is left to the post-deploy integration
 * smoke; this file pins the pure aggregation — how send rows and webhook
 * outcome rows correlate into per-template counts — so a regression there
 * surfaces in CI rather than as silently-wrong dashboard numbers.
 */

import { describe, expect, test } from 'bun:test';

import { aggregateTemplateStats } from './email-admin.js';

interface Row {
  action: string;
  metadata: Record<string, unknown> | null;
}

const send = (template: string, messageId: string | null, transport: 'mittera' | 'smtp' = 'mittera'): Row => ({
  action: `${transport}.${template}.sent`,
  metadata: messageId ? { messageId } : {},
});

const outcome = (type: 'delivered' | 'bounced' | 'complained', messageId: string | null): Row => ({
  action: `mittera.email.${type}`,
  metadata: messageId ? { messageId } : {},
});

describe('aggregateTemplateStats', () => {
  test('counts sends grouped by template', () => {
    const stats = aggregateTemplateStats(
      [send('magic_link', 'm1'), send('magic_link', 'm2'), send('invitation', 'm3')],
      [],
    );
    const byTemplate = Object.fromEntries(stats.map((s) => [s.template, s.sends]));
    expect(byTemplate.magic_link).toBe(2);
    expect(byTemplate.invitation).toBe(1);
  });

  test('correlates delivery outcomes back to the template via messageId', () => {
    const stats = aggregateTemplateStats(
      [send('magic_link', 'm1'), send('magic_link', 'm2'), send('invitation', 'm3')],
      [outcome('delivered', 'm1'), outcome('bounced', 'm2'), outcome('complained', 'm3')],
    );
    const magic = stats.find((s) => s.template === 'magic_link')!;
    expect(magic).toEqual({ template: 'magic_link', sends: 2, delivered: 1, bounced: 1, complained: 0 });
    const invite = stats.find((s) => s.template === 'invitation')!;
    expect(invite).toEqual({ template: 'invitation', sends: 1, delivered: 0, bounced: 0, complained: 1 });
  });

  test('handles the old double-prefixed mittera.email.* outcome action shape', () => {
    const stats = aggregateTemplateStats(
      [send('verify_email', 'm9')],
      [{ action: 'mittera.email.delivered', metadata: { messageId: 'm9' } }],
    );
    expect(stats[0]!.delivered).toBe(1);
  });

  test('counts smtp-fallback sends under the same template', () => {
    const stats = aggregateTemplateStats(
      [send('reset_password', 'm1', 'mittera'), send('reset_password', 'm2', 'smtp')],
      [],
    );
    expect(stats[0]).toEqual({
      template: 'reset_password',
      sends: 2,
      delivered: 0,
      bounced: 0,
      complained: 0,
    });
  });

  test('skips an outcome whose send is outside the window (no template to attribute)', () => {
    const stats = aggregateTemplateStats(
      [send('magic_link', 'm1')],
      [outcome('delivered', 'm1'), outcome('bounced', 'unknown-mid')],
    );
    expect(stats).toHaveLength(1);
    expect(stats[0]).toEqual({
      template: 'magic_link',
      sends: 1,
      delivered: 1,
      bounced: 0,
      complained: 0,
    });
  });

  test('ignores non-send / non-outcome rows and sends with no messageId still count', () => {
    const stats = aggregateTemplateStats(
      [
        send('magic_link', null), // accepted by mittera but no id echoed — still a send
        { action: 'mittera.email.opened', metadata: { messageId: 'm1' } }, // not a .sent row
      ],
      [{ action: 'mittera.email.opened', metadata: { messageId: 'm1' } }], // not a tracked outcome
    );
    expect(stats).toHaveLength(1);
    expect(stats[0]).toEqual({
      template: 'magic_link',
      sends: 1,
      delivered: 0,
      bounced: 0,
      complained: 0,
    });
  });

  test('sorts templates by send volume descending', () => {
    const stats = aggregateTemplateStats(
      [send('a', 'a1'), send('b', 'b1'), send('b', 'b2'), send('b', 'b3'), send('c', 'c1'), send('c', 'c2')],
      [],
    );
    expect(stats.map((s) => s.template)).toEqual(['b', 'c', 'a']);
  });
});
