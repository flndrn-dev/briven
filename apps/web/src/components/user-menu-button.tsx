'use client';

import { useEffect, useRef, useState } from 'react';

import {
  ChevronsUpDownIcon,
  type ChevronsUpDownIconHandle,
} from './ui/chevrons-up-down';

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
 * Dropdown opens upward with a docs link and sign-out.
 *
 * why: the user's own email appears only to themselves within their own
 * authenticated sidebar — the same trust boundary as CLAUDE.md §5.1's
 * carve-out for the Settings/Account page.
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
              <a
                href="https://docs.briven.cloud"
                target="_blank"
                rel="noreferrer"
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 rounded px-3 py-2 font-mono text-sm text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-overlay)] hover:text-[var(--color-text)]"
              >
                <BookIcon />
                docs
              </a>
            </li>
            <li>
              <button
                type="button"
                role="menuitem"
                onClick={signOut}
                disabled={signingOut}
                className="flex w-full items-center gap-3 rounded px-3 py-2 font-mono text-sm text-[var(--color-error)] transition-colors hover:bg-[var(--color-surface-overlay)] disabled:opacity-50"
              >
                <LogOutIcon />
                {signingOut ? 'signing out…' : 'log out'}
              </button>
            </li>
          </ul>
        </div>
      )}
    </div>
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

function BookIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
    </svg>
  );
}

function LogOutIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}
