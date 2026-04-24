'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { BookOpenIcon, type BookOpenIconHandle } from './ui/book-open';
import { LayoutGridIcon, type LayoutGridIconHandle } from './ui/layout-grid';
import { LogOutIcon, type LogOutIconHandle } from './ui/log-out';

interface UserInfo {
  name: string | null;
  email: string;
  image: string | null;
  legalName: string | null;
}

/**
 * Landing-page avatar menu, shown in place of the "sign in" link when the
 * visitor already has a session. Mirrors the sidebar UserMenuButton's
 * dropdown contents but opens downward (the button lives at the top of
 * the page, not the bottom of a sidebar).
 *
 * Each row drives its own icon animation from hover on the whole row so
 * the motion kicks in the moment the cursor crosses the button's padding,
 * not only the icon's 16px surface.
 */
export function LandingUserMenu({ user }: { user: UserInfo }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const displayName = user.legalName ?? user.name ?? user.email.split('@')[0]!;

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
      window.location.href = '/';
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`account menu for ${displayName}`}
        title={displayName}
        className="flex size-9 items-center justify-center rounded-full border border-[var(--color-border-subtle)] transition-colors hover:border-[var(--color-border)]"
      >
        <Avatar user={user} size={28} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-60 overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] shadow-[var(--shadow-lg)]"
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
              <AnimatedMenuButton
                icon={LayoutGridIcon}
                label="dashboard"
                onSelect={() => {
                  setOpen(false);
                  router.push('/dashboard');
                }}
              />
            </li>
            <li>
              <AnimatedMenuAnchor
                href="https://docs.briven.cloud"
                icon={BookOpenIcon}
                label="docs"
                target="_blank"
                rel="noreferrer"
                onSelect={() => setOpen(false)}
              />
            </li>
            <li>
              <AnimatedMenuButton
                icon={LogOutIcon}
                label={signingOut ? 'signing out…' : 'log out'}
                disabled={signingOut}
                destructive
                onSelect={signOut}
              />
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}

type IconHandle = LayoutGridIconHandle | BookOpenIconHandle | LogOutIconHandle;
type IconComponent = typeof LayoutGridIcon | typeof BookOpenIcon | typeof LogOutIcon;

function useRowHover() {
  const ref = useRef<IconHandle>(null);
  const [hover, setHover] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    if (hover) ref.current.startAnimation();
    else ref.current.stopAnimation();
  }, [hover]);
  return {
    ref,
    handlers: {
      onMouseEnter: () => setHover(true),
      onMouseLeave: () => setHover(false),
      onFocus: () => setHover(true),
      onBlur: () => setHover(false),
    },
  };
}

function rowClasses(destructive?: boolean) {
  return `flex w-full items-center gap-3 rounded px-3 py-2 font-mono text-sm transition-colors ${
    destructive
      ? 'text-[var(--color-error)] hover:bg-[var(--color-surface-overlay)]'
      : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-overlay)] hover:text-[var(--color-text)]'
  } disabled:opacity-50`;
}

function iconNode(Icon: IconComponent, ref: React.Ref<IconHandle>) {
  return (
    <span className="pointer-events-none">
      <Icon ref={ref as never} size={16} />
    </span>
  );
}

function AnimatedMenuAnchor({
  href,
  icon: Icon,
  label,
  onSelect,
  target,
  rel,
}: {
  href: string;
  icon: IconComponent;
  label: string;
  onSelect?: () => void;
  target?: string;
  rel?: string;
}) {
  const { ref, handlers } = useRowHover();
  return (
    <a
      href={href}
      target={target}
      rel={rel}
      role="menuitem"
      onClick={onSelect}
      className={rowClasses()}
      {...handlers}
    >
      {iconNode(Icon, ref)}
      {label}
    </a>
  );
}

function AnimatedMenuButton({
  icon: Icon,
  label,
  onSelect,
  disabled,
  destructive,
}: {
  icon: IconComponent;
  label: string;
  onSelect?: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  const { ref, handlers } = useRowHover();
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      disabled={disabled}
      className={rowClasses(destructive)}
      {...handlers}
    >
      {iconNode(Icon, ref)}
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
