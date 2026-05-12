import { CHANGELOG_ENTRIES } from '../entries';

export const dynamic = 'force-static';
export const revalidate = 3600; // rebuild hourly; entries are added by deploy

const SITE = 'https://docs.briven.tech';

/**
 * RSS 2.0 feed of the changelog. Linked from the <head> of every docs
 * page so feed readers auto-discover. Static; revalidates hourly to
 * pick up newly-merged entries without a redeploy.
 */
export function GET(): Response {
  const items = CHANGELOG_ENTRIES.slice(0, 50)
    .map((e) => {
      const tags = e.tags.map((t) => `<category>${escape(t)}</category>`).join('');
      const url = `${SITE}/changelog`;
      // Use yyyy-mm-dd at 12:00 UTC for a stable pubDate — date-only entries
      // don't carry a time-of-day; this keeps the feed monotonically ordered.
      const pubDate = new Date(`${e.date}T12:00:00Z`).toUTCString();
      return `    <item>
      <title>${escape(e.title)}</title>
      <link>${url}</link>
      <guid isPermaLink="false">briven-${e.date}-${slug(e.title)}</guid>
      <pubDate>${pubDate}</pubDate>
      ${tags}
      <description>${escape(e.body)}</description>
    </item>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>briven changelog</title>
    <link>${SITE}/changelog</link>
    <atom:link href="${SITE}/changelog/feed.xml" rel="self" type="application/rss+xml" />
    <description>what's new in briven — feature releases, fixes, security updates.</description>
    <language>en</language>
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    status: 200,
    headers: {
      'content-type': 'application/rss+xml; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
