'use client';

import { useEffect, useRef, useState } from 'react';

import { BookOpenIcon, type BookOpenIconHandle } from './ui/book-open';
import {
  ChevronsUpDownIcon,
  type ChevronsUpDownIconHandle,
} from './ui/chevrons-up-down';
import { GlobeIcon, type GlobeIconHandle } from './ui/globe';
import { LogOutIcon, type LogOutIconHandle } from './ui/log-out';

interface UserInfo {
  name: string | null;
  email: string;
  image: string | null;
  legalName: string | null;
}

interface Props {
  user: UserInfo;
  collapsed: boolean;
}

/**
 * Sidebar-anchored user menu. Collapses to a bare avatar when the sidebar
 * is collapsed; expands to avatar + name + email + chevron when open.
 * Dropdown opens upward with a website/docs link and sign-out.
 *
 * why: the user's own email appears only to themselves within their own
 * authenticated sidebar — the same trust boundary as CLAUDE.md §5.1's
 * carve-out for the Settings/Account page.
 *
 * Icon animations are driven from each menu row's hover state via the
 * component handle — hovering anywhere in the row (icon, label, padding)
 * triggers the animation, not just the icon's own 16px surface.
 */
export function UserMenuButton({ user, collapsed }: Props) {
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const iconRef = useRef<ChevronsUpDownIconHandle>(null);
  const [hover, setHover] = useState(false);

  const displayName = user.legalName ?? user.name ?? user.email.split('@')[0]!;

  useEffect(() => {
    if (!iconRef.current) return;
    if (hover) iconRef.current.startAnimation();
    else iconRef.current.stopAnimation();
  }, [hover]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function signOut() {
    setSigningOut(true);
    try {
      await fetch('/api/v1/auth/sign-out', {
        method: 'POST',
        credentials: 'include',
      });
    } finally {
      window.location.href = '/signin';
    }
  }

  return (
    <div ref={containerRef} className={collapsed ? 'relative' : 'relative flex-1 min-w-0'}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={collapsed ? `account menu for ${displayName}` : undefined}
        title={collapsed ? displayName : undefined}
        className={
          collapsed
            ? 'flex size-8 items-center justify-center rounded-md border border-[var(--color-border-subtle)] transition-colors hover:border-[var(--color-border)]'
            : 'flex h-12 w-full items-center gap-2 rounded-md border border-[var(--color-border-subtle)] px-2 text-left transition-colors hover:border-[var(--color-border)]'
        }
      >
        <Avatar user={user} size={collapsed ? 20 : 28} />
        {!collapsed && (
          <>
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="truncate text-xs font-medium text-[var(--color-text)]">
                {displayName}
              </span>
              <span className="truncate font-mono text-[10px] text-[var(--color-text-subtle)]">
                {user.email}
              </span>
            </span>
            <span className="pointer-events-none text-[var(--color-text-muted)]">
              <ChevronsUpDownIcon ref={iconRef} size={14} />
            </span>
          </>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-0 z-50 mb-2 w-60 overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] shadow-[var(--shadow-lg)]"
        >
          <div className="flex items-center gap-3 border-b border-[var(--color-border-subtle)] px-3 py-3">
            <Avatar user={user} size={32} />
            <div className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="truncate text-sm font-medium text-[var(--color-text)]">
                {displayName}
              </span>
              <span className="truncate font-mono text-[11px] text-[var(--color-text-subtle)]">
                {user.email}
              </span>
            </div>
          </div>
          <ul className="p-1">
            <li>
              <MenuRow
                as="a"
                href="/"
                onSelect={() => setOpen(false)}
                icon={GlobeIcon}
                label="website"
              />
            </li>
            <li>
              <MenuRow
                as="a"
                href="https://docs.briven.cloud"
                target="_blank"
                rel="noreferrer"
                onSelect={() => setOpen(false)}
                icon={BookOpenIcon}
                label="docs"
              />
            </li>
            <li>
              <MenuRow
                as="button"
                onSelect={signOut}
                disabled={signingOut}
                icon={LogOutIcon}
                label={signingOut ? 'signing out…' : 'log out'}
                destructive
              />
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}

type IconHandle = GlobeIconHandle | BookOpenIconHandle | LogOutIconHandle;
type IconComponent = typeof GlobeIcon | typeof BookOpenIcon | typeof LogOutIcon;

interface MenuRowBaseProps {
  onSelect?: () => void;
  icon: IconComponent;
  label: string;
  destructive?: boolean;
  disabled?: boolean;
}
type MenuRowProps =
  | (MenuRowBaseProps & {
      as: 'a';
      href: string;
      target?: string;
      rel?: string;
    })
  | (MenuRowBaseProps & {
      as: 'button';
    });

/**
 * Single dropdown row. Owns the hover state so the icon's animation starts
 * the moment the cursor enters the row (not just the icon's 16px box).
 */
function MenuRow(props: MenuRowProps) {
  const { icon: Icon, label, destructive, onSelect, disabled } = props;
  const ref = useRef<IconHandle>(null);
  const [hover, setHover] = useState(false);

  useEffect(() => {
    if (!ref.current) return;
    if (hover && !disabled) ref.current.startAnimation();
    else ref.current.stopAnimation();
  }, [hover, disabled]);

  const base = `flex w-full items-center gap-3 rounded px-3 py-2 font-mono text-sm transition-colors ${
    destructive
      ? 'text-[var(--color-error)] hover:bg-[var(--color-surface-overlay)]'
      : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-overlay)] hover:text-[var(--color-text)]'
  } disabled:opacity-50`;

  const sharedHandlers = {
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    onFocus: () => setHover(true),
    onBlur: () => setHover(false),
  };

  const iconNode = (
    <span className="pointer-events-none">
      <Icon ref={ref as never} size={16} />
    </span>
  );

  if (props.as === 'a') {
    return (
      <a
        href={props.href}
        target={props.target}
        rel={props.rel}
        role="menuitem"
        onClick={onSelect}
        className={base}
        {...sharedHandlers}
      >
        {iconNode}
        {label}
      </a>
    );
  }
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      disabled={disabled}
      className={base}
      {...sharedHandlers}
    >
      {iconNode}
      {label}
    </button>
  );
}

function Avatar({ user, size }: { user: UserInfo; size: number }) {
  const initials = getInitials(user.legalName ?? user.name ?? user.email);
  if (user.image) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={user.image}
        alt=""
        width={size}
        height={size}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-full bg-[var(--color-primary-subtle)] font-mono text-[var(--color-primary)]"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
    >
      {initials}
    </span>
  );
}

function getInitials(source: string): string {
  const cleaned = source.trim();
  if (!cleaned) return '·';
  const parts = cleaned.includes('@') ? [cleaned.split('@')[0]!] : cleaned.split(/\s+/);
  const letters = parts
    .slice(0, 2)
    .map((p) => p[0])
    .filter(Boolean)
    .join('');
  return (letters || cleaned[0] || '·').toUpperCase();
}
