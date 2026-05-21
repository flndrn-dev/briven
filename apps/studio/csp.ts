const API_URL = process.env.NEXT_PUBLIC_API_URL
  ? new URL(process.env.NEXT_PUBLIC_API_URL).origin
  : ''
const BRIVEN_URL = process.env.BRIVEN_URL ? new URL(process.env.BRIVEN_URL).origin : ''
const GOTRUE_URL = process.env.NEXT_PUBLIC_GOTRUE_URL
  ? new URL(process.env.NEXT_PUBLIC_GOTRUE_URL).origin
  : ''
const MARKETPLACE_API_URL = process.env.NEXT_PUBLIC_MARKETPLACE_API_URL
  ? new URL(process.env.NEXT_PUBLIC_MARKETPLACE_API_URL).origin
  : ''

const BRIVEN_PROJECTS_URL = 'https://*.supabase.co https://*.storage.supabase.co'
const BRIVEN_PROJECTS_URL_WS = 'wss://*.supabase.co'

// construct the URL for the Websocket Local URLs
let BRIVEN_LOCAL_PROJECTS_URL_WS = ''
if (BRIVEN_URL) {
  const url = new URL(BRIVEN_URL)
  const wsUrl = `${url.hostname}:${url.port}`
  BRIVEN_LOCAL_PROJECTS_URL_WS = `ws://${wsUrl} wss://${wsUrl}`
}

// Needed to test docs search in local dev
const BRIVEN_DOCS_PROJECT_URL = process.env.NEXT_PUBLIC_BRIVEN_URL
  ? new URL(process.env.NEXT_PUBLIC_BRIVEN_URL).origin
  : ''

// Needed to test docs content API in local dev
const BRIVEN_CONTENT_API_URL = process.env.NEXT_PUBLIC_CONTENT_API_URL
  ? new URL(process.env.NEXT_PUBLIC_CONTENT_API_URL).origin
  : ''

const isDevOrStaging =
  process.env.NEXT_PUBLIC_VERCEL_ENV === 'preview' ||
  process.env.NEXT_PUBLIC_ENVIRONMENT === 'local' ||
  process.env.NEXT_PUBLIC_ENVIRONMENT === 'staging'

const NIMBUS_STAGING_PROJECTS_URL = 'https://*.nmb-proj.com'
const NIMBUS_STAGING_PROJECTS_URL_WS = 'wss://*.nmb-proj.com'

const NIMBUS_PROD_PROJECTS_URL = process.env.NIMBUS_PROD_PROJECTS_URL || ''
const NIMBUS_PROD_PROJECTS_URL_WS = process.env.NIMBUS_PROD_PROJECTS_URL_WS || ''

const BRIVEN_STAGING_PROJECTS_URL = 'https://*.briven.red https://*.storage.briven.red'
const BRIVEN_STAGING_PROJECTS_URL_WS = 'wss://*.briven.red'
const BRIVEN_COM_URL = 'https://supabase.com'
const CLOUDFLARE_CDN_URL = 'https://cdnjs.cloudflare.com'
const HCAPTCHA_SUBDOMAINS_URL = 'https://*.hcaptcha.com'
const HCAPTCHA_ASSET_URL = 'https://newassets.hcaptcha.com'
const HCAPTCHA_JS_URL = 'https://js.hcaptcha.com'
const CONFIGCAT_URL = 'https://cdn-global.configcat.com'
const CONFIGCAT_PROXY_URL = ['staging', 'local'].includes(process.env.NEXT_PUBLIC_ENVIRONMENT ?? '')
  ? 'https://configcat.briven.green'
  : 'https://configcat.supabase.com'
const STRIPE_SUBDOMAINS_URL = 'https://*.stripe.com'
const STRIPE_JS_URL = 'https://js.stripe.com'
const STRIPE_NETWORK_URL = 'https://*.stripe.network'
const CLOUDFLARE_URL = 'https://www.cloudflare.com'
const VERCEL_URL = 'https://vercel.com'
const VERCEL_INSIGHTS_URL = 'https://*.vercel-insights.com'
const GITHUB_API_URL = 'https://api.github.com'
const GITHUB_USER_CONTENT_URL = 'https://raw.githubusercontent.com'
const GITHUB_USER_AVATAR_URL = 'https://avatars.githubusercontent.com'
const GOOGLE_USER_AVATAR_URL = 'https://lh3.googleusercontent.com'

// This is a custom domain for Stape, which isused for GTM servers
const STAPE_URL = 'https://ss.supabase.com'

const VERCEL_LIVE_URL = 'https://vercel.live'
const SENTRY_URL =
  'https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://*.ingest.de.sentry.io'
const BRIVEN_ASSETS_URL =
  process.env.NEXT_PUBLIC_ENVIRONMENT === 'staging'
    ? 'https://frontend-assets.briven.green'
    : 'https://frontend-assets.supabase.com'
const POSTHOG_URL = isDevOrStaging ? 'https://ph.briven.green' : 'https://ph.supabase.com'

const USERCENTRICS_URLS = 'https://*.usercentrics.eu'
const USERCENTRICS_APP_URL = 'https://app.usercentrics.eu'

// used by vercel live preview
const PUSHER_URL = 'https://*.pusher.com'
const PUSHER_URL_WS = 'wss://*.pusher.com'

const GOOGLE_MAPS_API_URL = 'https://maps.googleapis.com'

export function getCSP() {
  const DEFAULT_SRC_URLS = [
    API_URL,
    BRIVEN_URL,
    GOTRUE_URL,
    MARKETPLACE_API_URL,
    BRIVEN_LOCAL_PROJECTS_URL_WS,
    BRIVEN_PROJECTS_URL,
    BRIVEN_PROJECTS_URL_WS,
    HCAPTCHA_SUBDOMAINS_URL,
    CONFIGCAT_URL,
    CONFIGCAT_PROXY_URL,
    STRIPE_SUBDOMAINS_URL,
    STRIPE_NETWORK_URL,
    CLOUDFLARE_URL,
    VERCEL_INSIGHTS_URL,
    GITHUB_API_URL,
    GITHUB_USER_CONTENT_URL,
    BRIVEN_ASSETS_URL,
    USERCENTRICS_URLS,
    STAPE_URL,
    GOOGLE_MAPS_API_URL,
    POSTHOG_URL,
    ...(!!NIMBUS_PROD_PROJECTS_URL ? [NIMBUS_PROD_PROJECTS_URL, NIMBUS_PROD_PROJECTS_URL_WS] : []),
    CLOUDFLARE_CDN_URL,
  ]
  const SCRIPT_SRC_URLS = [
    CLOUDFLARE_CDN_URL,
    HCAPTCHA_JS_URL,
    STRIPE_JS_URL,
    BRIVEN_ASSETS_URL,
    STAPE_URL,
    POSTHOG_URL,
    USERCENTRICS_URLS,
  ]
  const FRAME_SRC_URLS = [
    HCAPTCHA_ASSET_URL,
    STRIPE_JS_URL,
    STAPE_URL,
    ...(isDevOrStaging ? [POSTHOG_URL] : []),
  ]
  const IMG_SRC_URLS = [
    BRIVEN_URL,
    BRIVEN_COM_URL,
    BRIVEN_PROJECTS_URL,
    GITHUB_USER_AVATAR_URL,
    GOOGLE_USER_AVATAR_URL,
    BRIVEN_ASSETS_URL,
    USERCENTRICS_APP_URL,
    STAPE_URL,
    USERCENTRICS_URLS,
    MARKETPLACE_API_URL,
    ...(!!NIMBUS_PROD_PROJECTS_URL ? [NIMBUS_PROD_PROJECTS_URL, NIMBUS_PROD_PROJECTS_URL_WS] : []),
  ]
  const STYLE_SRC_URLS = [CLOUDFLARE_CDN_URL, BRIVEN_ASSETS_URL]
  const FONT_SRC_URLS = [CLOUDFLARE_CDN_URL, BRIVEN_ASSETS_URL]

  const defaultSrcDirective = [
    `default-src 'self'`,
    ...DEFAULT_SRC_URLS,
    ...(isDevOrStaging
      ? [
          BRIVEN_STAGING_PROJECTS_URL,
          BRIVEN_STAGING_PROJECTS_URL_WS,
          NIMBUS_STAGING_PROJECTS_URL,
          NIMBUS_STAGING_PROJECTS_URL_WS,
          VERCEL_LIVE_URL,
          BRIVEN_DOCS_PROJECT_URL,
          BRIVEN_CONTENT_API_URL,
        ]
      : []),
    PUSHER_URL_WS,
    SENTRY_URL,
  ].join(' ')

  const imgSrcDirective = [
    `img-src 'self'`,
    `blob:`,
    `data:`,
    ...IMG_SRC_URLS,
    ...(isDevOrStaging
      ? [BRIVEN_STAGING_PROJECTS_URL, NIMBUS_STAGING_PROJECTS_URL, VERCEL_URL]
      : []),
  ].join(' ')

  const scriptSrcDirective = [
    `script-src 'self'`,
    `'unsafe-eval'`,
    `'unsafe-inline'`,
    ...SCRIPT_SRC_URLS,
    VERCEL_LIVE_URL,
    PUSHER_URL,
    GOOGLE_MAPS_API_URL,
  ].join(' ')

  const frameSrcDirective = [`frame-src 'self'`, ...FRAME_SRC_URLS, VERCEL_LIVE_URL].join(' ')

  const styleSrcDirective = [
    `style-src 'self'`,
    `'unsafe-inline'`,
    ...STYLE_SRC_URLS,
    VERCEL_LIVE_URL,
  ].join(' ')

  const fontSrcDirective = [`font-src 'self'`, ...FONT_SRC_URLS, VERCEL_LIVE_URL].join(' ')

  const workerSrcDirective = [`worker-src 'self'`, `blob:`, `data:`].join(' ')

  const connectSrcDirective = [
    `connect-src 'self'`,
    `data:`,
    `blob:`,
    ...DEFAULT_SRC_URLS,
    ...(isDevOrStaging
      ? [
          BRIVEN_STAGING_PROJECTS_URL,
          BRIVEN_STAGING_PROJECTS_URL_WS,
          NIMBUS_STAGING_PROJECTS_URL,
          NIMBUS_STAGING_PROJECTS_URL_WS,
          VERCEL_LIVE_URL,
          BRIVEN_DOCS_PROJECT_URL,
          BRIVEN_CONTENT_API_URL,
        ]
      : []),
    PUSHER_URL_WS,
    SENTRY_URL,
  ].join(' ')

  const cspDirectives = [
    connectSrcDirective,
    defaultSrcDirective,
    imgSrcDirective,
    scriptSrcDirective,
    frameSrcDirective,
    styleSrcDirective,
    fontSrcDirective,
    workerSrcDirective,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `block-all-mixed-content`,
    ...(process.env.NEXT_PUBLIC_IS_PLATFORM === 'true' &&
    process.env.NEXT_PUBLIC_ENVIRONMENT === 'prod'
      ? [`upgrade-insecure-requests`]
      : []),
  ]

  const csp = cspDirectives.join('; ') + ';'

  // Replace newline characters and spaces
  return csp.replace(/\s{2,}/g, ' ').trim()
}
