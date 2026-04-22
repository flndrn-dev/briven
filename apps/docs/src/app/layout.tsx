import type { Metadata, Viewport } from 'next';
import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';

import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'briven docs',
    template: '%s · briven docs',
  },
  description: 'developer docs for briven — reactive postgres, worldwide, fully portable.',
  icons: {
    icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }],
    shortcut: '/favicon.svg',
  },
  metadataBase: new URL('https://docs.briven.cloud'),
};

export const viewport: Viewport = {
  themeColor: '#0a0b0d',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-dvh bg-[var(--color-bg)] text-[var(--color-text)]">{children}</body>
    </html>
  );
}
