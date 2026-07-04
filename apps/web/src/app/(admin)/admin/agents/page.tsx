import { apiJson } from '@/lib/api';
import { apiOrigin } from '@/lib/env';

import { AgentsBoard, type AgentsPayload } from './agents-client';

export const metadata = { title: 'ai agents · admin' };
export const dynamic = 'force-dynamic';

/**
 * AI agents — thin server shell. Fetches the first agent list server-side
 * (instant paint, cookies forwarded by apiFetch) and hands off to the client
 * board, which refetches after every mutation using the same api-origin +
 * credentials pattern the mcp page's client controls use.
 */
export default async function AdminAgentsPage() {
  const initial = await apiJson<AgentsPayload>('/v1/admin/agents').catch(() => null);
  return <AgentsBoard apiOrigin={apiOrigin} initial={initial} />;
}
