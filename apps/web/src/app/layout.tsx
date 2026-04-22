import type { Metadata, Viewport } from 'next';
import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';

import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'briven — the postgres backend you actually own',
    template: '%s · briven',
  },
  description:
    'reactive postgres, worldwide, fully portable. convex ergonomics without the lock-in.',
  icons: {
    icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }],
    shortcut: '/favicon.svg',
  },
  openGraph: {
    title: 'briven',
    description: 'the postgres backend you actually own',
    url: 'https://briven.cloud',
    siteName: 'briven',
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'briven',
    description: 'the postgres backend you actually own',
  },
  metadataBase: new URL('https://briven.cloud'),
};

export const viewport: Viewport = {
  themeColor: '#0a0b0d',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
