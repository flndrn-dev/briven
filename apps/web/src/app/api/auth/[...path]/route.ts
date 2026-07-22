/**
 * First-party briven-engine proxy (Step 4).
 *
 * Browser → https://briven.tech/api/auth/*  (same site as the app)
 *        → https://api.briven.tech/v1/auth-core/fdi/*
 *
 * Cookies (Set-Cookie) are written for the **app** host, not a foreign API host.
 *
 * Not production Auth for customers until flndrn OKs deploy of the full product.
 */

import { brivenEngineNextHandler } from '@briven/auth/engine/proxy';

const handler = brivenEngineNextHandler({
  apiOrigin:
    process.env.BRIVEN_API_ORIGIN ??
    process.env.NEXT_PUBLIC_BRIVEN_API_ORIGIN ??
    'https://api.briven.tech',
});

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
