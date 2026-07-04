import { apiJson } from '@/lib/api';
import { apiOrigin } from '@/lib/env';

import { HealthBoard, type HealthSummary } from './health-client';

export const metadata = { title: 'platform health · admin' };
export const dynamic = 'force-dynamic';

/**
 * Platform health — thin server shell. Fetches the first health summary
 * server-side (instant paint, cookies forwarded by apiFetch) and hands off
 * to the client board, which keeps it genuinely live by re-polling
 * /v1/admin/health every 10s with credentials — the same api-origin
 * pattern the mcp page's client controls use.
 */
export default async function AdminHealthPage() {
  const initial = await apiJson<HealthSummary>('/v1/admin/health').catch(() => null);
  return <HealthBoard apiOrigin={apiOrigin} initial={initial} />;
}
