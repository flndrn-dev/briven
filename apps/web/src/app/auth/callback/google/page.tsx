/**
 * Google OAuth callback blank during Auth product wipe.
 */
export default function GoogleCallbackBlankPage() {
  return (
    <main
      style={{
        fontFamily: 'ui-monospace, monospace',
        padding: '2rem',
        maxWidth: 480,
      }}
    >
      <p style={{ fontSize: 14 }}>Auth is not available yet.</p>
      <p style={{ marginTop: 8, fontSize: 12, color: '#888' }}>
        Sign-in for apps is being set up. You can still use briven.tech dashboard
        sign-in.
      </p>
    </main>
  );
}
