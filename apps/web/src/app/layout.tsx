import type { Metadata, Viewport } from 'next';
import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';
import Script from 'next/script';

import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Briven — the database anyone can use, no coding needed',
    template: '%s · Briven',
  },
  description:
    'Create and run a real database without writing code. Start from a template, edit your data like a spreadsheet, and undo any mistake in one click. Honest pricing, no surprise bills — made in Flanders.',
  keywords: [
    'no-code database',
    'database without coding',
    'database for non-coders',
    'easy online database',
    'database builder',
    'database with undo',
    'neon alternative',
    'supabase alternative',
  ],
  icons: {
    icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }],
    shortcut: '/favicon.svg',
  },
  openGraph: {
    title: 'Briven — the database anyone can use',
    description:
      'A real database without writing code. Templates, spreadsheet-style editing, one-click undo. Honest pricing, made in Flanders.',
    url: 'https://briven.tech',
    siteName: 'briven',
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Briven — the database anyone can use',
    description:
      'A real database without writing code. Templates, spreadsheet-style editing, one-click undo.',
  },
  metadataBase: new URL('https://briven.tech'),
};

export const viewport: Viewport = {
  themeColor: '#0a0b0d',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        {children}
        {/* umami analytics — analytics.flndrn.com */}
        <Script
          defer
          src="https://analytics.flndrn.com/script.js"
          data-website-id="0b497796-2cd7-4663-bafc-d35d69bd2cf3"
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}
