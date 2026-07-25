/**
 * Product wall for service badges.
 *
 * After requireProjectAuth, if the caller authenticated with a service badge
 * (c.var.serviceBadgeProduct is set), they may only hit routes for that product.
 * Humans (session), deploy keys (brk_), CLI JWT, and Auth M2M JWTs are not
 * product-locked — they keep full project access for their role.
 */

import { ForbiddenError } from '@briven/shared';
import type { MiddlewareHandler } from 'hono';

import type { ServiceBadgeProduct } from '../db/schema.js';
import { serviceBadgeAllowedOnRoute } from '../services/service-badges.js';

/**
 * Require that a service-badge caller is allowed on this product wall.
 * Pass the product this route family belongs to (db | s3 | auth).
 */
export const requireServiceProduct =
  (routeProduct: ServiceBadgeProduct): MiddlewareHandler =>
  async (c, next) => {
    const badgeProduct = c.get('serviceBadgeProduct') as ServiceBadgeProduct | null | undefined;
    if (!serviceBadgeAllowedOnRoute(badgeProduct ?? null, routeProduct)) {
      throw new ForbiddenError(
        `this service badge only opens the ${badgeProduct} product — not ${routeProduct}`,
      );
    }
    await next();
  };
