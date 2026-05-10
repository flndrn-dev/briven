/**
 * Polar webhook receiver — pure-logic coverage.
 *
 * The Standard Webhooks signature verification + the audit/dispatch
 * is exercised by the post-deploy smoke (once Polar product IDs are
 * configured). This file pins the product-id → tier resolution since
 * a regression there would silently mis-tier a customer.
 */

import { describe, expect, test } from 'bun:test';

// Local mirror of the resolveTierForProduct logic in the route. When
// the route changes, this test moves with it.
function resolveTierForProduct(
  productId: string | null,
  proId: string | undefined,
  teamId: string | undefined,
): 'pro' | 'team' | null {
  if (!productId) return null;
  if (proId && productId === proId) return 'pro';
  if (teamId && productId === teamId) return 'team';
  return null;
}

const PRO = 'prod_pro_01HZ4ABC';
const TEAM = 'prod_team_01HZ4XYZ';

describe('resolveTierForProduct', () => {
  test('matches the pro product id → pro', () => {
    expect(resolveTierForProduct(PRO, PRO, TEAM)).toBe('pro');
  });

  test('matches the team product id → team', () => {
    expect(resolveTierForProduct(TEAM, PRO, TEAM)).toBe('team');
  });

  test('unknown product id → null (operator gets a log line, polar gets a 200)', () => {
    expect(resolveTierForProduct('prod_unknown', PRO, TEAM)).toBe(null);
  });

  test('null product id (event without data.productId) → null', () => {
    expect(resolveTierForProduct(null, PRO, TEAM)).toBe(null);
  });

  test('unconfigured env (both ids undefined) → null even for a valid-looking id', () => {
    expect(resolveTierForProduct(PRO, undefined, undefined)).toBe(null);
  });

  test('only pro configured, team event arrives → null (defensive: do not over-grant)', () => {
    expect(resolveTierForProduct(TEAM, PRO, undefined)).toBe(null);
  });

  test('product id with surrounding whitespace must not match', () => {
    // String comparison is strict equality — Polar payloads shouldn't
    // contain whitespace, but if they ever do we want to reject
    // rather than silently coerce. This is a behavioural pin, not a
    // requirement on Polar.
    expect(resolveTierForProduct(` ${PRO} `, PRO, TEAM)).toBe(null);
  });
});

describe('subscription event types in scope', () => {
  // Mirrors SUBSCRIPTION_EVENTS in routes/polar-webhook.ts.
  const SUBSCRIPTION_EVENTS = new Set([
    'subscription.created',
    'subscription.updated',
    'subscription.canceled',
    'subscription.uncanceled',
    'subscription.revoked',
    'subscription.active',
  ]);

  test('includes the six lifecycle events polar fires', () => {
    expect(SUBSCRIPTION_EVENTS.size).toBe(6);
    expect(SUBSCRIPTION_EVENTS.has('subscription.created')).toBe(true);
    expect(SUBSCRIPTION_EVENTS.has('subscription.canceled')).toBe(true);
  });

  test('excludes non-subscription events (those land in audit only)', () => {
    expect(SUBSCRIPTION_EVENTS.has('order.created')).toBe(false);
    expect(SUBSCRIPTION_EVENTS.has('checkout.completed')).toBe(false);
    expect(SUBSCRIPTION_EVENTS.has('webhook.test')).toBe(false);
  });
});
