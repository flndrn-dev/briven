/**
 * Old overview page — layout already shows the moved notice for all /auth/*
 * routes. Keep a no-op page so Next still resolves the segment.
 */
export const metadata = { title: 'auth' };
export const dynamic = 'force-dynamic';

export default function AuthOverviewPage() {
  return null;
}
