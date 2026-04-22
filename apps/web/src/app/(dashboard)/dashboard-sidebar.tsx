'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { ChevronRightIcon, type ChevronRightIconHandle } from '../../components/ui/chevron-right';
import { CogIcon, type CogIconHandle } from '../../components/ui/cog';
import { FoldersIcon, type FoldersIconHandle } from '../../components/ui/folders';
import { ShieldCheckIcon, type ShieldCheckIconHandle } from '../../components/ui/shield-check';

const STORAGE_KEY = 'briven.sidebar.collapsed';

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
  match: (pathname: string) => boolean;
  adminOnly?: boolean;
}

const NAV: NavItem[] = [
  {
    href: '/dashboard/projects',
    label: 'projects',
    Icon: FoldersIcon as never,
    match: (p) => p.startsWith('/dashboard/projects'),
  },
  {
    href: '/dashboard/settings',
    label: 'settings',
    Icon: CogIcon as never,
    match: (p) => p.startsWith('/dashboard/settings'),
  },
  {
    href: '/dashboard/admin',
    label: 'admin',
    Icon: ShieldCheckIcon as never,
    match: (p) => p.startsWith('/dashboard/admin'),
    adminOnly: true,
  },
];

type IconHandle = FoldersIconHandle | CogIconHandle | ShieldCheckIconHandle;

export function DashboardSidebar({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === '1') setCollapsed(true);
    } catch {
      // storage blocked — default open
    }
    setHydrated(true);
  }, []);

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      } catch {
        // ignore
      }
      return next;
    });
  }

  const items = NAV.filter((i) => !i.adminOnly || isAdmin);
  const isCollapsed = hydrated && collapsed;
  // open = size-7 (28px), collapsed = size-8 (32px) per the design direction.
  const iconPixels = isCollapsed ? 32 : 28;

  const toggleRef = useRef<ChevronRightIconHandle>(null);
  const [toggleHover, setToggleHover] = useState(false);

  useEffect(() => {
    if (!toggleRef.current) return;
    if (toggleHover) toggleRef.current.startAnimation();
    else toggleRef.current.stopAnimation();
  }, [toggleHover]);

  return (
    <aside
      aria-label="dashboard sections"
      data-collapsed={isCollapsed ? 'true' : 'false'}
      className={`relative flex h-full shrink-0 flex-col transition-[width] duration-200 ease-out ${
        isCollapsed ? 'w-[72px]' : 'w-[180px]'
      }`}
    >
      <ul className="flex flex-col gap-1">
        {items.map((item) => (
          <SidebarLink
            key={item.href}
            item={item}
            active={item.match(pathname)}
            iconPixels={iconPixels}
            collapsed={isCollapsed}
          />
        ))}
      </ul>

      {/*
        Absolutely pinned to the sidebar's bottom — with the layout now
        filling the viewport and the sidebar set to h-full, this lands
        bottom-5 from the viewport edge exactly. Centered under the
        sidebar column via left-1/2 + translate.
      */}
      <button
        type="button"
        onClick={toggle}
        onMouseEnter={() => setToggleHover(true)}
        onMouseLeave={() => setToggleHover(false)}
        onFocus={() => setToggleHover(true)}
        onBlur={() => setToggleHover(false)}
        aria-label={isCollapsed ? 'expand sidebar' : 'collapse sidebar'}
        className="absolute bottom-5 left-1/2 flex size-8 -translate-x-1/2 items-center justify-center rounded-md border border-[var(--color-border-subtle)] text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-border)] hover:text-[var(--color-primary)]"
      >
        <span
          className="pointer-events-none inline-block"
          style={{
            transform: `rotate(${isCollapsed ? 0 : 180}deg)`,
            transition: 'transform 200ms',
          }}
        >
          <ChevronRightIcon ref={toggleRef} size={18} />
        </span>
      </button>
    </aside>
  );
}

function SidebarLink({
  item,
  active,
  iconPixels,
  collapsed,
}: {
  item: NavItem;
  active: boolean;
  iconPixels: number;
  collapsed: boolean;
}) {
  const iconRef = useRef<IconHandle>(null);
  const [hovering, setHovering] = useState(false);
  const { Icon } = item;

  // Drive the icon's imperative animation from the Link's hover state —
  // this way hovering ANYWHERE in the Link's box (padding, label, or
  // icon) triggers the animation, not only when the cursor is on the
  // icon's inner div.
  useEffect(() => {
    if (!iconRef.current) return;
    if (hovering) iconRef.current.startAnimation();
    else iconRef.current.stopAnimation();
  }, [hovering]);

  return (
    <li>
      <Link
        href={item.href}
        aria-current={active ? 'page' : undefined}
        title={collapsed ? item.label : undefined}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        onFocus={() => setHovering(true)}
        onBlur={() => setHovering(false)}
        className={`flex items-center gap-3 rounded-md px-3 py-2 font-mono text-sm transition-colors ${
          active
            ? 'bg-[var(--color-surface)] text-[var(--color-primary)]'
            : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-primary)]'
        } ${collapsed ? 'justify-center px-0' : ''}`}
      >
        {/* pointer-events-none on the icon's own mouse surface so its
            internal onMouseEnter doesn't compete with the Link's. The
            animation is driven via the ref from the Link's hover state
            above. */}
        <span className="pointer-events-none">
          <Icon ref={iconRef as never} size={iconPixels} />
        </span>
        {collapsed ? (
          <span className="sr-only">{item.label}</span>
        ) : (
          <span className="truncate">{item.label}</span>
        )}
      </Link>
    </li>
  );
}
