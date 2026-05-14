import { fetchIncidents, type IncidentEntry } from '../../../../lib/incidents';

/**
 * RSS feed of the incident history. Operators + customers can subscribe
 * to get alerted on new entries without checking the status page. Mirrors
 * the changelog feed shape so subscribers can use the same reader setup.
 *
 * Served at /api/status/incidents.xml — when the status page DNS
 * cutover to status.briven.tech lands, the feed moves to
 * status.briven.tech/incidents.xml via a redirect.
 *
 * Reads from the api (/v1/status/incidents) at request time. The api
 * being unreachable yields an empty feed rather than a 5xx, so RSS
 * subscribers don't get a poison-pilled feed on a transient outage.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const SITE_URL = process.env.BRIVEN_DOCS_ORIGIN ?? 'https://docs.briven.tech';
const STATUS_URL = process.env.BRIVEN_STATUS_ORIGIN ?? `${SITE_URL}/status`;

export async function GET(): Promise<Response> {
  const items = await fetchIncidents({ limit: 50, fresh: true });
  const lastBuild = items[0]?.startedAt ?? new Date().toISOString();

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>briven · incidents</title>
<link>${STATUS_URL}</link>
<description>incident history for briven.tech — outages, degraded performance, planned maintenance</description>
<language>en</language>
<lastBuildDate>${new Date(lastBuild).toUTCString()}</lastBuildDate>
<atom:link href="${SITE_URL}/api/status/incidents.xml" rel="self" type="application/rss+xml" />
${items
  .map(
    (inc) => `<item>
<title>${escapeXml(`[${inc.severity}] ${inc.summary}`)}</title>
<link>${STATUS_URL}#${inc.id}</link>
<guid isPermaLink="false">${inc.id}</guid>
<pubDate>${new Date(inc.startedAt).toUTCString()}</pubDate>
<category>${inc.severity}</category>
${inc.services.map((s) => `<category>${escapeXml(s)}</category>`).join('\n')}
<description>${escapeXml(buildDescription(inc))}</description>
</item>`,
  )
  .join('\n')}
</channel>
</rss>
`;

  return new Response(xml, {
    status: 200,
    headers: {
      'content-type': 'application/rss+xml; charset=utf-8',
      'cache-control': 'public, max-age=60, s-maxage=60',
    },
  });
}

function buildDescription(inc: IncidentEntry): string {
  const status = inc.resolvedAt
    ? `resolved ${inc.resolvedAt}`
    : 'ongoing';
  const parts = [`started ${inc.startedAt}`, status, `services: ${inc.services.join(', ')}`];
  if (inc.postmortem) parts.push('---', inc.postmortem);
  return parts.join('\n');
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
