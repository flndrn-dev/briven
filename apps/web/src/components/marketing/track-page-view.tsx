'use client';

import { useEffect, useRef } from 'react';

interface Props {
  apiOrigin: string;
  source: string;
}

/**
 * Fire-and-forget pageview beacon. Posts once per mount to
 * /v1/marketing-events on the api origin. The api is rate-limited
 * 30/min per IP so a misbehaving client can't write-amplify the
 * meta-DB. We deliberately don't surface failures — analytics gaps
 * are preferable to UX impact.
 */
export function TrackPageView({ apiOrigin, source }: Props) {
  // Strict Mode + Next dev mounts components twice; the ref guards
  // against the duplicate beacon. The api ignores duplicates within
  // the rate window anyway.
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    if (!apiOrigin) return;
    void fetch(`${apiOrigin}/v1/marketing-events`, {
      method: 'POST',
      keepalive: true,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ eventType: 'migrate_view', source }),
    }).catch(() => {
      // analytics failure is a no-op
    });
  }, [apiOrigin, source]);

  return null;
}
