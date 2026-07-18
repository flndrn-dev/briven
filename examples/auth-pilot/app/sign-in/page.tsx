'use client';

import { auth } from '../../lib/auth';

/**
 * Fastest pilot: send the user to Briven-hosted sign-in, then back to /dashboard.
 * For an embedded form, swap this for <BrivenSignIn /> from @briven/auth/react.
 */
export default function SignInPage() {
  return (
    <main style={{ fontFamily: 'system-ui', padding: 48, maxWidth: 420 }}>
      <h1 style={{ fontSize: 22, marginBottom: 12 }}>Sign in</h1>
      <p style={{ color: '#555', marginBottom: 24, lineHeight: 1.5 }}>
        This pilot uses Briven&apos;s hosted sign-in page. After you sign in, you
        return to <code>/dashboard</code>.
      </p>
      <button
        type="button"
        onClick={() => {
          window.location.assign(auth.hostedPageURL('sign-in', '/dashboard'));
        }}
        style={{
          padding: '10px 16px',
          borderRadius: 8,
          border: '1px solid #222',
          background: '#111',
          color: '#fff',
          cursor: 'pointer',
        }}
      >
        Continue to sign in
      </button>
    </main>
  );
}
