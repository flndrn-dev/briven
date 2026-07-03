'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { ActivityIcon } from '@/components/ui/activity';
import { ArrowLeftRightIcon } from '@/components/ui/arrow-left-right';
import { BotIcon } from '@/components/ui/bot';
import { CogIcon } from '@/components/ui/cog';
import { CreditCardIcon } from '@/components/ui/credit-card';
import { DatabaseIcon } from '@/components/ui/database';
import { FoldersIcon } from '@/components/ui/folders';
import { LayoutGridIcon } from '@/components/ui/layout-grid';
import { LifeBuoyIcon } from '@/components/ui/life-buoy';
import { MailIcon } from '@/components/ui/mail';
import { RocketIcon } from '@/components/ui/rocket';
import { ShieldCheckIcon } from '@/components/ui/shield-check';
import { TriangleAlertIcon } from '@/components/ui/triangle-alert';
import { UsersIcon } from '@/components/ui/users';
import { ZapIcon } from '@/components/ui/zap';

interface IconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface NavItem {
  href: string;
  label: string;
  Icon: (props: {
    className?: string;
    size?: number;
    ref?: unknown;
    onMouseEnter?: (e: React.MouseEvent) => void;
    onMouseLeave?: (e: React.MouseEvent) => void;
  }) => ReactNode;
  // Exact match by default; prefix-match for sections with sub-routes.
  match: (pathname: string) => boolean;
}

interface NavGroup {
  // Small uppercase header above the group; null for the top (overview) group.
  title: string | null;
  items: NavItem[];
}

// Grouped nav. Order matters — groups render top-to-bottom, items in-order.
const NAV_GROUPS: NavGroup[] = [
  {
    title: null,
    items: [
      { href: '/admin', label: 'overview', Icon: LayoutGridIcon as never, match: (p) => p === '/admin' },
    ],
  },
  {
    title: 'money',
    items: [
      {
        href: '/admin/billing',
        label: 'subscribers & billing',
        Icon: CreditCardIcon as never,
        match: (p) => p.startsWith('/admin/billing'),
      },
    ],
  },
  {
    title: 'customers',
    items: [
      {
        href: '/admin/users',
        label: 'users',
        Icon: UsersIcon as never,
        match: (p) => p.startsWith('/admin/users'),
      },
      {
        href: '/admin/projects',
        label: 'projects',
        Icon: FoldersIcon as never,
        match: (p) => p.startsWith('/admin/projects'),
      },
    ],
  },
  {
    title: 'agents',
    items: [
      {
        href: '/admin/mcp',
        label: 'mcp / agent access',
        Icon: BotIcon as never,
        match: (p) => p.startsWith('/admin/mcp'),
      },
      {
        href: '/admin/agents',
        label: 'ai agents',
        Icon: BotIcon as never,
        match: (p) => p.startsWith('/admin/agents'),
      },
    ],
  },
  {
    title: 'platform',
    items: [
      {
        href: '/admin/health',
        label: 'platform health',
        Icon: ActivityIcon as never,
        match: (p) => p.startsWith('/admin/health'),
      },
      {
        href: '/admin/realtime',
        label: 'realtime',
        Icon: ZapIcon as never,
        match: (p) => p.startsWith('/admin/realtime'),
      },
      {
        href: '/admin/storage',
        label: 'storage',
        Icon: DatabaseIcon as never,
        match: (p) => p.startsWith('/admin/storage'),
      },
      {
        href: '/admin/deploys',
        label: 'deploys',
        Icon: RocketIcon as never,
        match: (p) => p.startsWith('/admin/deploys'),
      },
    ],
  },
  {
    title: 'operations',
    items: [
      {
        href: '/admin/incidents',
        label: 'incidents',
        Icon: TriangleAlertIcon as never,
        match: (p) => p.startsWith('/admin/incidents'),
      },
      {
        href: '/admin/abuse-reports',
        label: 'abuse & allowlist',
        Icon: ShieldCheckIcon as never,
        match: (p) => p.startsWith('/admin/abuse-reports'),
      },
      {
        href: '/admin/migrations',
        label: 'migrations',
        Icon: ArrowLeftRightIcon as never,
        match: (p) => p.startsWith('/admin/migrations'),
      },
      {
        href: '/admin/messages',
        label: 'messages',
        Icon: MailIcon as never,
        match: (p) => p.startsWith('/admin/messages'),
      },
      {
        href: '/admin/tickets',
        label: 'tickets',
        Icon: LifeBuoyIcon as never,
        match: (p) => p.startsWith('/admin/tickets'),
      },
      {
        href: '/admin/email-events',
        label: 'email',
        Icon: MailIcon as never,
        match: (p) => p.startsWith('/admin/email-events'),
      },
    ],
  },
  {
    title: 'system',
    items: [
      {
        href: '/admin/launch',
        label: 'launch controls',
        Icon: ZapIcon as never,
        match: (p) => p.startsWith('/admin/launch'),
      },
      {
        href: '/admin/settings',
        label: 'settings',
        Icon: CogIcon as never,
        match: (p) => p.startsWith('/admin/settings'),
      },
    ],
  },
];

export function CockpitNav() {
  const pathname = usePathname();

  return (
    <aside
      aria-label="admin sections"
      className="hidden h-full w-[200px] shrink-0 overflow-y-auto border-r border-[var(--color-border-subtle)] px-3 py-4 md:block"
    >
      <ul className="flex flex-col gap-1">
        {NAV_GROUPS.map((group) => (
          <li key={group.title ?? 'overview'} className={group.title ? 'mt-4 first:mt-0' : undefined}>
            {group.title ? (
              <span className="block px-3 pb-1 font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
                {group.title}
              </span>
            ) : null}
            <ul className="flex flex-col gap-1">
              {group.items.map((item) => (
                <NavLink key={item.href} item={item} active={item.match(pathname)} />
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const iconRef = useRef<IconHandle>(null);
  const [hovering, setHovering] = useState(false);
  const { Icon } = item;

  // Drive the icon's imperative animation from the Link's hover state so
  // hovering anywhere in the row (not only the icon) triggers it — mirrors
  // the dashboard sidebar pattern.
  useEffect(() => {
    if (!iconRef.current) return;
    if (hovering) iconRef.current.startAnimation();
    else iconRef.current.stopAnimation();
  }, [hovering]);

  return (
    <li>
      <Link
        href={item.href as never}
        aria-current={active ? 'page' : undefined}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        onFocus={() => setHovering(true)}
        onBlur={() => setHovering(false)}
        className={`flex items-center gap-3 rounded-[var(--radius-md)] px-3 py-2 font-mono text-sm transition-colors ${
          active
            ? 'bg-[var(--color-surface)] text-[var(--color-primary)]'
            : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-primary)]'
        }`}
      >
        <span className="pointer-events-none shrink-0">
          <Icon ref={iconRef as never} size={20} />
        </span>
        <span className="truncate">{item.label}</span>
      </Link>
    </li>
  );
}
