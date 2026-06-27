'use client';

import { motion, useAnimation } from 'motion/react';
import type { HTMLAttributes } from 'react';
import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';

import { cn } from '@/lib/utils';

export interface ArrowLeftRightIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface ArrowLeftRightIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const ArrowLeftRightIcon = forwardRef<ArrowLeftRightIconHandle, ArrowLeftRightIconProps>(
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
        if (isControlledRef.current) onMouseEnter?.(e);
        else controls.start('animate');
      },
      [controls, onMouseEnter],
    );

    const handleMouseLeave = useCallback(
      (e: React.MouseEvent<HTMLDivElement>) => {
        if (isControlledRef.current) onMouseLeave?.(e);
        else controls.start('normal');
      },
      [controls, onMouseLeave],
    );

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
          <motion.g
            animate={controls}
            transition={{ duration: 0.5, ease: 'easeInOut' }}
            variants={{
              normal: { x: 0 },
              animate: { x: [0, -2, 0] },
            }}
          >
            <path d="M8 3 4 7l4 4" />
            <path d="M4 7h16" />
          </motion.g>
          <motion.g
            animate={controls}
            transition={{ duration: 0.5, ease: 'easeInOut' }}
            variants={{
              normal: { x: 0 },
              animate: { x: [0, 2, 0] },
            }}
          >
            <path d="m16 21 4-4-4-4" />
            <path d="M20 17H4" />
          </motion.g>
        </svg>
      </div>
    );
  },
);

ArrowLeftRightIcon.displayName = 'ArrowLeftRightIcon';

export { ArrowLeftRightIcon };
