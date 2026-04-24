'use client';

import { motion, useAnimation } from 'motion/react';
import type { HTMLAttributes } from 'react';
import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';

import { cn } from '@/lib/utils';

export interface LayoutGridIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface LayoutGridIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const LayoutGridIcon = forwardRef<LayoutGridIconHandle, LayoutGridIconProps>(
  ({ onMouseEnter, onMouseLeave, className, size = 18, ...props }, ref) => {
    const controls = useAnimation();
    const isControlledRef = useRef(false);

    useImperativeHandle(ref, () => {
      isControlledRef.current = true;
      return {
        startAnimation: () => controls.start('animate'),
        stopAnimation: () => controls.start('normal'),
      };
    });

    const handleMouseEnter = useCallback(
      (e: React.MouseEvent<HTMLDivElement>) => {
        if (isControlledRef.current) {
          onMouseEnter?.(e);
        } else {
          controls.start('animate');
        }
      },
      [controls, onMouseEnter],
    );

    const handleMouseLeave = useCallback(
      (e: React.MouseEvent<HTMLDivElement>) => {
        if (isControlledRef.current) {
          onMouseLeave?.(e);
        } else {
          controls.start('normal');
        }
      },
      [controls, onMouseLeave],
    );

    const tileTransition = { type: 'spring' as const, stiffness: 300, damping: 20 };

    return (
      <div
        className={cn(className)}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        {...props}
      >
        <svg
          fill="none"
          height={size}
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
          width={size}
          xmlns="http://www.w3.org/2000/svg"
        >
          <motion.rect
            x="3"
            y="3"
            width="7"
            height="7"
            rx="1"
            animate={controls}
            transition={tileTransition}
            variants={{
              normal: { translateX: 0, translateY: 0 },
              animate: { translateX: -1, translateY: -1 },
            }}
          />
          <motion.rect
            x="14"
            y="3"
            width="7"
            height="7"
            rx="1"
            animate={controls}
            transition={{ ...tileTransition, delay: 0.04 }}
            variants={{
              normal: { translateX: 0, translateY: 0 },
              animate: { translateX: 1, translateY: -1 },
            }}
          />
          <motion.rect
            x="14"
            y="14"
            width="7"
            height="7"
            rx="1"
            animate={controls}
            transition={{ ...tileTransition, delay: 0.08 }}
            variants={{
              normal: { translateX: 0, translateY: 0 },
              animate: { translateX: 1, translateY: 1 },
            }}
          />
          <motion.rect
            x="3"
            y="14"
            width="7"
            height="7"
            rx="1"
            animate={controls}
            transition={{ ...tileTransition, delay: 0.12 }}
            variants={{
              normal: { translateX: 0, translateY: 0 },
              animate: { translateX: -1, translateY: 1 },
            }}
          />
        </svg>
      </div>
    );
  },
);

LayoutGridIcon.displayName = 'LayoutGridIcon';

export { LayoutGridIcon };
