import { describe, expect, test } from 'bun:test';

import {
  BRIVEN_AREA_GUIDES,
  BRIVEN_ASK_TOOLS,
  DOCS_INDEX,
  matchBrivenGuides,
} from './mcp-briven-ask.js';

describe('briven_ask reception desk — pure helpers', () => {
  test('storage question matches the storage guide first', () => {
    const guides = matchBrivenGuides('how do I upload files and get a public share link?');
    expect(guides.length).toBeGreaterThan(0);
    expect(guides[0]!.id).toBe('storage');
  });

  test('realtime question matches the realtime guide', () => {
    const ids = matchBrivenGuides('can my app subscribe to live updates via websocket?').map(
      (g) => g.id,
    );
    expect(ids).toContain('realtime');
  });

  test('migration question matches the migration guide', () => {
    const ids = matchBrivenGuides('we want to migrate from supabase, how?').map((g) => g.id);
    expect(ids).toContain('migration');
  });

  test('rate-limit question matches usage-limits', () => {
    const ids = matchBrivenGuides('we keep hitting the rate limit on bulk insert').map(
      (g) => g.id,
    );
    expect(ids).toContain('usage-limits');
  });

  test('completely foreign question matches nothing (→ filed path)', () => {
    expect(matchBrivenGuides('kubernetes ingress annotations for istio')).toEqual([]);
  });

  test('THE CONTRACT: every guide has all three parts + docs citation', () => {
    for (const g of BRIVEN_AREA_GUIDES) {
      expect(g.howBrivenWorksHere.length).toBeGreaterThan(40);
      expect(g.whatOurToolsGiveYou.length).toBeGreaterThan(0);
      expect(g.whatYouBuildInYourProject.length).toBeGreaterThan(0);
      expect(g.docs).toStartWith('https://docs.briven.tech');
    }
  });

  test('guides and docs index never name internal vendors', () => {
    const blob = (JSON.stringify(BRIVEN_AREA_GUIDES) + JSON.stringify(DOCS_INDEX)).toLowerCase();
    expect(blob).not.toContain('mittera');
    expect(blob).not.toContain('stripe');
    expect(blob).not.toContain('polar');
  });

  test('docs index urls resolve to the docs host', () => {
    for (const d of DOCS_INDEX) expect(d.slug).toStartWith('/');
  });

  test('BRIVEN_ASK_TOOLS exports exactly briven_ask', () => {
    expect([...BRIVEN_ASK_TOOLS]).toEqual(['briven_ask']);
  });
});
