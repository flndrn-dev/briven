import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'briven — the postgres backend you actually own';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * Dynamic OG image for briven.tech. Edge-runtime, generated on demand;
 * Next caches it at the CDN once rendered. Keep this in sync with the
 * landing page's hero — copy + visual identity should match what
 * arrives on Twitter / LinkedIn.
 */
export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          backgroundColor: '#0a0b0d',
          padding: '64px',
          color: '#f1f5f9',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '8px',
              backgroundColor: '#5b8def',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#0a0b0d',
              fontSize: '32px',
              fontWeight: 700,
            }}
          >
            b
          </div>
          <span style={{ fontSize: '32px', fontWeight: 500 }}>briven</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <h1
            style={{
              margin: 0,
              fontSize: '88px',
              fontWeight: 500,
              lineHeight: 1.05,
              letterSpacing: '-0.03em',
            }}
          >
            the postgres backend
            <br />
            you actually own.
          </h1>
          <p
            style={{
              margin: 0,
              fontSize: '32px',
              color: '#94a3b8',
              lineHeight: 1.4,
              maxWidth: '900px',
            }}
          >
            reactive queries, typed schema, one-command deploys — on vanilla postgres.
            self-hostable. pg_dump is your escape hatch.
          </p>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '24px',
            color: '#64748b',
          }}
        >
          <span>briven.tech</span>
          <span>
            built with <span style={{ color: '#e8344a' }}>♥</span> in Flanders
          </span>
        </div>
      </div>
    ),
    { ...size },
  );
}
