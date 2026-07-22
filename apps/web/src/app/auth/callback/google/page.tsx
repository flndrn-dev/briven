'use client';

/**
 * Browser Google OAuth callback.
 * Receives ?code=&state= from Google, posts to Auth FDI /signinup.
 */

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

function GoogleCallbackInner() {
  const params = useSearchParams();
  const [msg, setMsg] = useState('Completing Google sign-in…');

  useEffect(() => {
    const code = params.get('code');
    const state = params.get('state');
    const err = params.get('error');
    if (err) {
      setMsg(`Google error: ${err}`);
      return;
    }
    if (!code) {
      setMsg('Missing code from Google.');
      return;
    }

    const origin =
      process.env.NEXT_PUBLIC_BRIVEN_API_ORIGIN?.replace(/\/$/, '') ||
      'https://api.briven.tech';
    const redirectURI = `${window.location.origin}/auth/callback/google`;
    const projectId =
      sessionStorage.getItem('briven_oauth_project') ||
      process.env.NEXT_PUBLIC_BRIVEN_PROJECT_ID ||
      '';

    void (async () => {
      try {
        const res = await fetch(`${origin}/v1/auth-core/fdi/signinup`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'content-type': 'application/json',
            ...(projectId ? { 'x-briven-project-id': projectId } : {}),
          },
          body: JSON.stringify({
            thirdPartyId: 'google',
            code,
            state,
            redirectURI,
          }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          status?: string;
          message?: string;
          user?: { id?: string; email?: string };
        };
        if (!res.ok || body.status !== 'OK') {
          setMsg(body.message ?? `Sign-in failed (${res.status})`);
          return;
        }
        setMsg(
          `Signed in as ${body.user?.email ?? body.user?.id ?? 'user'}. You can close this window.`,
        );
        const next = sessionStorage.getItem('briven_oauth_next');
        if (next) {
          window.location.href = next;
        }
      } catch (e) {
        setMsg(e instanceof Error ? e.message : 'Network error');
      }
    })();
  }, [params]);

  return (
    <main
      style={{
        fontFamily: 'ui-monospace, monospace',
        padding: '2rem',
        maxWidth: 480,
      }}
    >
      <p style={{ fontSize: 12, letterSpacing: '0.15em', color: '#FFFD74' }}>
        Auth · Google
      </p>
      <p style={{ marginTop: 12 }}>{msg}</p>
    </main>
  );
}

export default function GoogleCallbackPage() {
  return (
    <Suspense
      fallback={
        <main
          style={{
            fontFamily: 'ui-monospace, monospace',
            padding: '2rem',
          }}
        >
          Completing Google sign-in…
        </main>
      }
    >
      <GoogleCallbackInner />
    </Suspense>
  );
}
