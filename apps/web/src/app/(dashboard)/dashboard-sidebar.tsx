'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { UserMenuButton } from '../../components/user-menu-button';
import { ChevronRightIcon, type ChevronRightIconHandle } from '../../components/ui/chevron-right';
import { CogIcon, type CogIconHandle } from '../../components/ui/cog';
import { CreditCardIcon, type CreditCardIconHandle } from '../../components/ui/credit-card';
import { DatabaseIcon, type DatabaseIconHandle } from '../../components/ui/database';
import { FoldersIcon, type FoldersIconHandle } from '../../components/ui/folders';
import { LayoutGridIcon, type LayoutGridIconHandle } from '../../components/ui/layout-grid';
import { ShieldCheckIcon, type ShieldCheckIconHandle } from '../../components/ui/shield-check';
import { UsersIcon, type UsersIconHandle } from '../../components/ui/users';

const STORAGE_KEY = 'briven.sidebar.collapsed';

/** Auth section accent — used only for icon + label when that row is active. */
const AUTH_ACCENT = '#e6b800';

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
  /**
   * When active, icon + label use the Auth yellow (same shape as other
   * rows — no solid pill, no side bar). Idle state matches every other link.
   */
  authProduct?: boolean;
}

const NAV: NavItem[] = [
  {
    href: '/dashboard',
    label: 'overview',
    Icon: LayoutGridIcon as never,
    // Exact match — broader prefix would steal the active state from
    // every nested dashboard route.
    match: (p) => p === '/dashboard',
  },
  {
    href: '/dashboard/projects',
    label: 'projects',
    Icon: FoldersIcon as never,
    match: (p) => p.startsWith('/dashboard/projects'),
  },
  {
    href: '/dashboard/auth',
    label: 'Authentication',
    Icon: ShieldCheckIcon as never,
    match: (p) => p.startsWith('/dashboard/auth'),
    authProduct: true,
  },
  {
    href: '/dashboard/s3',
    label: 'S3 bucket',
    Icon: DatabaseIcon as never,
    match: (p) => p.startsWith('/dashboard/s3'),
  },
  {
    href: '/dashboard/teams',
    label: 'teams',
    Icon: UsersIcon as never,
    match: (p) => p.startsWith('/dashboard/teams'),
  },
  {
    href: '/dashboard/billing',
    label: 'billing',
    Icon: CreditCardIcon as never,
    match: (p) => p.startsWith('/dashboard/billing'),
  },
  {
    href: '/dashboard/settings',
    label: 'settings',
    Icon: CogIcon as never,
    match: (p) => p.startsWith('/dashboard/settings'),
  },
  // No 'admin' nav item here on purpose: the ONE admin entry lives in the
  // avatar dropdown (UserMenuButton) and points to admin.briven.tech. The
  // old /dashboard/admin area redirects there too (see proxy.ts).
];

type IconHandle =
  | FoldersIconHandle
  | CogIconHandle
  | ShieldCheckIconHandle
  | CreditCardIconHandle
  | DatabaseIconHandle
  | UsersIconHandle
  | LayoutGridIconHandle;

interface SidebarUser {
  name: string | null;
  email: string;
  image: string | null;
  legalName: string | null;
}

export function DashboardSidebar({ isAdmin, user }: { isAdmin: boolean; user: SidebarUser }) {
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
  // Collapsed rail is the denser state — icons shrink instead of growing.
  const iconPixels = isCollapsed ? 22 : 28;

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
      // hidden on small screens — the rail eats too much of a phone
      // viewport. mobile nav lives in the top-of-content tabs row + the
      // user menu in the header. surfaces md (768px) and up.
      className={`relative hidden h-full shrink-0 flex-col transition-[width] duration-200 ease-out md:flex ${
        isCollapsed ? 'md:w-[72px]' : 'md:w-[180px]'
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
            authProduct={item.authProduct === true}
          />
        ))}
      </ul>

      {/*
        Bottom stack: when expanded, user button + collapse toggle sit
        side-by-side so the user button's avatar lines up with the nav
        icons above (both at px-3 from the sidebar edge). When collapsed,
        they stack vertically inside the 72px rail.
      */}
      <div
        className={`absolute bottom-3 left-0 right-0 flex ${
          isCollapsed
            ? 'flex-col items-center gap-2'
            : 'flex-row items-center gap-1'
        }`}
      >
        <UserMenuButton user={user} collapsed={isCollapsed} isAdmin={isAdmin} />
        <button
          type="button"
          onClick={toggle}
          onMouseEnter={() => setToggleHover(true)}
          onMouseLeave={() => setToggleHover(false)}
          onFocus={() => setToggleHover(true)}
          onBlur={() => setToggleHover(false)}
          aria-label={isCollapsed ? 'expand sidebar' : 'collapse sidebar'}
          className={`flex shrink-0 items-center justify-center rounded-md border border-[var(--color-border-subtle)] text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-border)] hover:text-[var(--color-primary)] ${
            isCollapsed ? 'size-8' : 'size-6'
          }`}
        >
          <span
            className="pointer-events-none inline-block"
            style={{
              transform: `rotate(${isCollapsed ? 0 : 180}deg)`,
              transition: 'transform 200ms',
            }}
          >
            <ChevronRightIcon ref={toggleRef} size={isCollapsed ? 18 : 14} />
          </span>
        </button>
      </div>
    </aside>
  );
}

function SidebarLink({
  item,
  active,
  iconPixels,
  collapsed,
  authProduct,
}: {
  item: NavItem;
  active: boolean;
  iconPixels: number;
  collapsed: boolean;
  authProduct: boolean;
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

  // Same row chrome as every other nav item. Auth only recolors icon +
  // label yellow when active (mirrors how projects uses green primary).
  const activeAuth = active && authProduct;

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
            ? 'bg-[var(--color-surface)]'
            : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-primary)]'
        } ${collapsed ? 'justify-center px-0' : ''}`}
        style={
          active
            ? activeAuth
              ? { color: AUTH_ACCENT }
              : { color: 'var(--color-primary)' }
            : undefined
        }
      >
        {/* pointer-events-none on the icon's own mouse surface so its
            internal onMouseEnter doesn't compete with the Link's. The
            animation is driven via the ref from the Link's hover state
            above. */}
        <span className="pointer-events-none" style={activeAuth ? { color: AUTH_ACCENT } : undefined}>
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
