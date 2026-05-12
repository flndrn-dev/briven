import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'briven docs — reactive postgres, worldwide, fully portable';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * Dynamic OG image for docs.briven.tech. Same identity as the marketing
 * site OG, but copy positions this as docs.
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
          <span style={{ fontSize: '28px', fontWeight: 500 }}>
            briven <span style={{ color: '#94a3b8' }}>· docs</span>
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <h1
            style={{
              margin: 0,
              fontSize: '72px',
              fontWeight: 500,
              lineHeight: 1.05,
              letterSpacing: '-0.03em',
            }}
          >
            developer docs.
          </h1>
          <p
            style={{
              margin: 0,
              fontSize: '28px',
              color: '#94a3b8',
              lineHeight: 1.4,
              maxWidth: '1000px',
            }}
          >
            quickstart · schema dsl · examples · functions · http api · migration guides ·
            self-host · cli · changelog.
          </p>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '22px',
            color: '#64748b',
          }}
        >
          <span>docs.briven.tech</span>
          <span>open-core · agpl-3.0</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
