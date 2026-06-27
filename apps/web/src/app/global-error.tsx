'use client';

/**
 * Root-layout error boundary. This replaces the whole document (the root
 * layout failed), so globals.css + fonts are NOT available — styles are
 * inlined so the fallback always renders. Only triggers on catastrophic
 * root-level errors; segment errors use error.tsx.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '1rem',
          background: '#0a0b0d',
          color: '#e6e6e6',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: '14px',
          padding: '2rem',
          textAlign: 'center',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" width={28} height={28} />
          <span>briven</span>
        </div>
        <h1 style={{ fontSize: '1.5rem', margin: 0, letterSpacing: '-0.02em' }}>
          something broke
        </h1>
        <p style={{ color: '#9a9a9a', margin: 0, maxWidth: '32rem' }}>
          briven hit an unexpected error. it&apos;s been logged. try reloading.
        </p>
        {error.digest ? (
          <p style={{ color: '#6a6a6a', margin: 0, fontSize: '10px' }}>reference: {error.digest}</p>
        ) : null}
        <button
          type="button"
          onClick={reset}
          style={{
            marginTop: '0.5rem',
            border: '1px solid #2a2c31',
            background: '#15171a',
            color: '#e6e6e6',
            borderRadius: '6px',
            padding: '0.75rem 1rem',
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontSize: '14px',
          }}
        >
          ↻ reload
        </button>
        <footer style={{ marginTop: '2rem', fontSize: '10px', color: '#6a6a6a' }}>
          built with <span style={{ color: '#e8344a' }}>♥</span> in Flanders · flndrn
        </footer>
      </body>
    </html>
  );
}
