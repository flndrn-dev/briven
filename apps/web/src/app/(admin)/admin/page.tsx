import { apiJson } from '@/lib/api';
import { apiOrigin } from '@/lib/env';

import { OverviewDashboard, type Overview } from './overview-client';

export const metadata = { title: 'overview · admin' };
export const dynamic = 'force-dynamic';

/**
 * Admin overview — thin server shell. Fetches the first payload server-side
 * (instant paint, cookies forwarded by apiFetch) and hands off to the
 * client dashboard, which keeps it live by re-polling /v1/admin/overview
 * every 10s with credentials — the same api-origin pattern the mcp page's
 * client controls use.
 */
export default async function AdminOverviewPage() {
  const initial = await apiJson<Overview>('/v1/admin/overview').catch(() => null);
  return <OverviewDashboard apiOrigin={apiOrigin} initial={initial} />;
}
