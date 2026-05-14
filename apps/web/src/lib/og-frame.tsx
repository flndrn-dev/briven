import { ImageResponse } from 'next/og';

/**
 * Shared layout for every opengraph-image.tsx in the marketing surface.
 * Each route's file owns the metadata (alt + this re-export) and calls
 * `renderOg` with its title + subtitle.
 *
 * Constraints from next/og:
 *   - flexbox-only css (no grid)
 *   - no <Image>, no SVG file refs; everything's inline css
 *   - default sans fallback — Geist isn't auto-available in the og runtime
 *     and fetching woff2 inside ImageResponse is more complexity than the
 *     payoff justifies. The visual identity carries via colour + layout.
 */

export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_CONTENT_TYPE = 'image/png' as const;

const COLORS = {
  bg: '#0a0b0d',
  text: '#f1f5f9',
  muted: '#94a3b8',
  subtle: '#64748b',
  primary: '#00e87a', // briven green per BRAND.md
  heartRed: '#e8344a',
  borderSubtle: '#1e2128',
} as const;

interface RenderOgInput {
  /** Big block. Up to ~30 chars per line; we don't auto-wrap. */
  title: string;
  /** Smaller line under the title; optional. */
  subtitle?: string;
  /** Tiny mono uppercase tag in the brand colour at the top — section name. */
  eyebrow?: string;
}

export function renderOg(input: RenderOgInput): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          backgroundColor: COLORS.bg,
          padding: '64px',
          color: COLORS.text,
          fontFamily: 'system-ui, sans-serif',
          // Grid backdrop matches the marketing pages' BackgroundGrid.
          backgroundImage:
            'linear-gradient(to right, #1e2128 1px, transparent 1px), linear-gradient(to bottom, #1e2128 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      >
        {/* Top — brand mark */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '10px',
              backgroundColor: COLORS.primary,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: COLORS.bg,
              fontSize: '26px',
              fontWeight: 700,
              fontFamily: 'monospace',
            }}
          >
            b
          </div>
          <span
            style={{
              fontSize: '28px',
              fontWeight: 500,
              fontFamily: 'monospace',
              letterSpacing: '-0.01em',
            }}
          >
            briven
          </span>
          <span
            style={{
              fontSize: '22px',
              color: COLORS.subtle,
              fontFamily: 'monospace',
            }}
          >
            · tech
          </span>
        </div>

        {/* Middle — title + subtitle */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {input.eyebrow ? (
            <div
              style={{
                fontSize: '22px',
                color: COLORS.primary,
                fontFamily: 'monospace',
                textTransform: 'uppercase',
                letterSpacing: '0.12em',
              }}
            >
              {input.eyebrow}
            </div>
          ) : null}
          <h1
            style={{
              margin: 0,
              fontSize: '82px',
              fontWeight: 500,
              lineHeight: 1.05,
              letterSpacing: '-0.03em',
              maxWidth: '1000px',
              // `\n` in input.title renders as a line break.
              whiteSpace: 'pre-wrap',
            }}
          >
            {input.title}
          </h1>
          {input.subtitle ? (
            <p
              style={{
                margin: 0,
                fontSize: '30px',
                color: COLORS.muted,
                lineHeight: 1.4,
                maxWidth: '950px',
              }}
            >
              {input.subtitle}
            </p>
          ) : null}
        </div>

        {/* Bottom — domain + flanders */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '22px',
            color: COLORS.subtle,
            fontFamily: 'monospace',
            borderTop: `1px solid ${COLORS.borderSubtle}`,
            paddingTop: '20px',
          }}
        >
          <span>briven.tech</span>
          <span>
            built with <span style={{ color: COLORS.heartRed }}>♥</span> in Flanders
          </span>
        </div>
      </div>
    ),
    { ...OG_SIZE },
  );
}
