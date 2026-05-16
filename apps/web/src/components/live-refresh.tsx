'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

const CHANNEL_NAME = 'briven:dashboard';
const POLL_MS = 30_000;

/**
 * Real-time refresh plumbing for the dashboard. Mounted once in the
 * dashboard layout so every page under /dashboard inherits the same
 * revalidation cadence:
 *
 *  1. router.refresh() on window focus + visibilitychange (visible).
 *  2. router.refresh() every 30s while the tab is visible.
 *  3. BroadcastChannel listener — any form in any tab can call
 *     `notifyDashboardChange()` after a successful mutation; every open
 *     dashboard tab refreshes immediately.
 *
 * Control-plane reads stay server-rendered (RSC) — this layer just keeps
 * them honest without forcing a manual reload. When the api grows an SSE
 * endpoint we'll add that as a fourth trigger.
 */
export function LiveRefresh() {
  const router = useRouter();

  useEffect(() => {
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    function refresh() {
      router.refresh();
    }

    function startPolling() {
      if (pollTimer) return;
      pollTimer = setInterval(() => {
        if (document.visibilityState === 'visible') refresh();
      }, POLL_MS);
    }

    function stopPolling() {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === 'visible') {
        refresh();
        startPolling();
      } else {
        stopPolling();
      }
    }

    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisibilityChange);
    if (document.visibilityState === 'visible') startPolling();

    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = () => refresh();
    } catch {
      // older browsers without BroadcastChannel — silently skip cross-tab
    }

    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      stopPolling();
      channel?.close();
    };
  }, [router]);

  return null;
}

/**
 * Call after a successful mutation that other dashboard pages may want
 * to see. Posts on the BroadcastChannel; the `<LiveRefresh>` mounted on
 * every dashboard route picks it up and triggers router.refresh().
 *
 * Safe to call from any client component — no-op on browsers without
 * BroadcastChannel.
 */
export function notifyDashboardChange(): void {
  if (typeof window === 'undefined') return;
  try {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.postMessage({ at: Date.now() });
    channel.close();
  } catch {
    // ignore
  }
}
