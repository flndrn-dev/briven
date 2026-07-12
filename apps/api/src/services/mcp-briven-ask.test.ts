import { describe, expect, test } from 'bun:test';

import {
  BRIVEN_AREA_GUIDES,
  BRIVEN_ASK_TOOLS,
  DOCS_INDEX,
  matchBrivenGuides,
  redactSecrets,
  topicKey,
} from './mcp-briven-ask.js';
import { coerceGroundedAnswer, validateStoredAnswer } from './mcp-answer-writer.js';

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

  // The exact class of question the Unleashed agent got wrong (probed for a
  // raw-SQL endpoint, concluded "no path"). The new card must catch it.
  test('a "read tables from a python app" question matches app-data-access', () => {
    const ids = matchBrivenGuides('how do I read my database tables from a python app?').map(
      (g) => g.id,
    );
    expect(ids).toContain('app-data-access');
  });

  test('a "call briven from go with my server key" question matches app-data-access', () => {
    const ids = matchBrivenGuides('how do I connect from my go backend using my server key?').map(
      (g) => g.id,
    );
    expect(ids).toContain('app-data-access');
  });
});

describe('briven_ask self-growing KB — helpers', () => {
  test('topicKey is invariant to word order, filler words, and casing', () => {
    const a = topicKey('How do I read my tables from a Python app?');
    const b = topicKey('read tables in a python app');
    expect(a).toBe(b);
  });

  test('topicKey is deterministic and non-empty even for all-filler input', () => {
    expect(topicKey('how do I do this?').length).toBeGreaterThan(0);
    expect(topicKey('python tables')).toBe(topicKey('tables python'));
  });

  test('coerceGroundedAnswer accepts a well-formed grounded object', () => {
    const answer = coerceGroundedAnswer({
      grounded: true,
      howBrivenWorksHere: 'apps call functions; there is no raw sql endpoint by design.',
      whatOurToolsGiveYou: ['POST /v1/projects/<id>/functions/<name> with a brk_ key', ''],
      whatYouBuildInYourProject: ['write a saveRun function and call it over http'],
      docs: 'https://docs.briven.tech/functions',
    });
    expect(answer).not.toBeNull();
    expect(answer!.whatOurToolsGiveYou).toHaveLength(1); // blank stripped
    expect(answer!.docs).toBe('https://docs.briven.tech/functions');
  });

  test('coerceGroundedAnswer rejects a decline (grounded:false)', () => {
    expect(coerceGroundedAnswer({ grounded: false })).toBeNull();
  });

  test('coerceGroundedAnswer rejects a substanceless answer', () => {
    expect(
      coerceGroundedAnswer({ grounded: true, howBrivenWorksHere: 'no', whatOurToolsGiveYou: [] }),
    ).toBeNull();
  });

  test('topicKey stays non-empty for a degenerate all-short-token question', () => {
    // "I a b" has no multi-char word tokens; must still yield a stable key.
    expect(topicKey('I a b').length).toBeGreaterThan(0);
  });

  test('validateStoredAnswer accepts a stored answer (no grounded flag) and rejects a blank one', () => {
    const good = validateStoredAnswer({
      howBrivenWorksHere: 'apps call functions; there is no raw sql endpoint by design.',
      whatOurToolsGiveYou: ['POST /v1/projects/<id>/functions/<name>'],
      whatYouBuildInYourProject: [],
      docs: 'https://docs.briven.tech/functions',
    });
    expect(good).not.toBeNull();
    // A drifted/hand-seeded blank row must be treated as a miss, not served.
    expect(
      validateStoredAnswer({ howBrivenWorksHere: '', whatOurToolsGiveYou: [] }),
    ).toBeNull();
  });

  test('redactSecrets strips briven keys and long opaque tokens from a stored question', () => {
    const scrubbed = redactSecrets(
      'why does brk_01ABCDEF2345 fail and my token pk_briven_mcp_ZZZ9998887 too?',
    );
    expect(scrubbed).not.toContain('01ABCDEF2345');
    expect(scrubbed).not.toContain('ZZZ9998887');
    expect(scrubbed).toContain('[redacted]');
  });

  test('coerceGroundedAnswer repairs a missing/invalid docs url', () => {
    const answer = coerceGroundedAnswer({
      grounded: true,
      howBrivenWorksHere: 'this is a sufficiently long grounded explanation of the platform.',
      whatOurToolsGiveYou: ['use the mcp data tools'],
      whatYouBuildInYourProject: [],
      docs: 'not-a-url',
    });
    expect(answer!.docs).toBe('https://docs.briven.tech');
  });
});
