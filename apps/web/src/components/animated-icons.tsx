'use client';

import { motion, type MotionProps } from 'motion/react';
import { useEffect, useState } from 'react';

/**
 * Animated SVG icons in the lucide-animated.com style — stateless between
 * renders, replay the entrance tween on hover. Each icon is wrapped in a
 * `<motion.span>` that owns the hover state, so the caller just drops the
 * component in.
 *
 * Sizing: icons respect `className` width/height utilities (size-5, size-6,
 * etc.). Stroke scales with currentColor.
 */

interface IconProps {
  className?: string;
  // Force the hover animation to replay — useful for driving from a parent
  // (e.g. sidebar-collapse trigger).
  animate?: boolean;
}

function useHoverKey(animate?: boolean): number {
  // Changing `key` re-mounts the motion children, replaying the animation.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (animate) setTick((t) => t + 1);
  }, [animate]);
  return tick;
}

const iconBase = {
  xmlns: 'http://www.w3.org/2000/svg',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function HoverWrap({
  children,
  className,
}: {
  children: (hover: boolean) => React.ReactNode;
  className?: string;
}) {
  const [hover, setHover] = useState(false);
  return (
    <span
      className={className}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
    >
      {children(hover)}
    </span>
  );
}

/** Folder icon — flap lifts on hover. */
export function FolderIcon({ className, animate }: IconProps) {
  const key = useHoverKey(animate);
  return (
    <HoverWrap className={className}>
      {(hover) => (
        <svg key={`folder-${key}-${hover ? 1 : 0}`} {...iconBase} className="size-full">
          <motion.path
            d="M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7z"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
          />
          <motion.path
            d="M4 10h16"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={hover ? { pathLength: 1, opacity: 1 } : { pathLength: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
          />
        </svg>
      )}
    </HoverWrap>
  );
}

/** Settings gear — rotates 45° on hover. */
export function SettingsIcon({ className, animate }: IconProps) {
  const key = useHoverKey(animate);
  return (
    <HoverWrap className={className}>
      {(hover) => (
        <motion.svg
          key={`settings-${key}`}
          {...iconBase}
          className="size-full"
          animate={{ rotate: hover ? 45 : 0 }}
          transition={{ type: 'spring', stiffness: 200, damping: 15 }}
        >
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
          <circle cx="12" cy="12" r="3" />
        </motion.svg>
      )}
    </HoverWrap>
  );
}

/** Shield (admin) — scales + pulses briefly on hover. */
export function ShieldIcon({ className, animate }: IconProps) {
  const key = useHoverKey(animate);
  return (
    <HoverWrap className={className}>
      {(hover) => (
        <motion.svg
          key={`shield-${key}`}
          {...iconBase}
          className="size-full"
          animate={{ scale: hover ? 1.1 : 1 }}
          transition={{ type: 'spring', stiffness: 250, damping: 12 }}
        >
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          <motion.path
            d="m9 12 2 2 4-4"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={hover ? { pathLength: 1, opacity: 1 } : { pathLength: 0, opacity: 0.7 }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
          />
        </motion.svg>
      )}
    </HoverWrap>
  );
}

/**
 * Copy icon that morphs into a checkmark when `copied` is true.
 * The caller owns the `copied` state (set on click, clear on timeout).
 */
export function CopyIcon({ className, copied = false }: IconProps & { copied?: boolean }) {
  return (
    <span className={className}>
      <svg {...iconBase} className="size-full">
        {/* the two-rectangle copy glyph, faded out when copied */}
        <motion.g animate={{ opacity: copied ? 0 : 1 }} transition={{ duration: 0.15 }}>
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </motion.g>
        {/* the checkmark, strokes in on copy */}
        <motion.path
          d="M5 12l5 5L20 7"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={copied ? { pathLength: 1, opacity: 1 } : { pathLength: 0, opacity: 0 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
        />
      </svg>
    </span>
  );
}

/** Chevron pointing left/right — used by the sidebar collapse toggle. */
export function ChevronIcon({
  className,
  direction,
  ...rest
}: IconProps & { direction: 'left' | 'right' } & MotionProps) {
  const rotate = direction === 'left' ? 180 : 0;
  return (
    <motion.svg
      {...iconBase}
      className={className}
      animate={{ rotate }}
      transition={{ type: 'spring', stiffness: 300, damping: 22 }}
      {...rest}
    >
      <path d="m9 18 6-6-6-6" />
    </motion.svg>
  );
}
