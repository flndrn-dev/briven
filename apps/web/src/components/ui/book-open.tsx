"use client";

import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";

import { cn } from "@/lib/utils";

export interface BookOpenIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface BookOpenIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const BookOpenIcon = forwardRef<BookOpenIconHandle, BookOpenIconProps>(
  ({ onMouseEnter, onMouseLeave, className, size = 18, ...props }, ref) => {
    const controls = useAnimation();
    const isControlledRef = useRef(false);

    useImperativeHandle(ref, () => {
      isControlledRef.current = true;
      return {
        startAnimation: () => controls.start("animate"),
        stopAnimation: () => controls.start("normal"),
      };
    });

    const handleMouseEnter = useCallback(
      (e: React.MouseEvent<HTMLDivElement>) => {
        if (isControlledRef.current) {
          onMouseEnter?.(e);
        } else {
          controls.start("animate");
        }
      },
      [controls, onMouseEnter],
    );

    const handleMouseLeave = useCallback(
      (e: React.MouseEvent<HTMLDivElement>) => {
        if (isControlledRef.current) {
          onMouseLeave?.(e);
        } else {
          controls.start("normal");
        }
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
          <motion.path
            animate={controls}
            d="M12 7v14"
            transition={{ duration: 0.35, ease: "easeOut" }}
            variants={{
              normal: { pathLength: 1, opacity: 1 },
              animate: { pathLength: [0, 1], opacity: [0.4, 1] },
            }}
          />
          <motion.path
            animate={controls}
            d="M16 12h2"
            transition={{ duration: 0.3, delay: 0.1, ease: "easeOut" }}
            variants={{
              normal: { pathLength: 1, opacity: 1 },
              animate: { pathLength: [0, 1], opacity: [0, 1] },
            }}
          />
          <motion.path
            animate={controls}
            d="M16 8h2"
            transition={{ duration: 0.3, delay: 0.05, ease: "easeOut" }}
            variants={{
              normal: { pathLength: 1, opacity: 1 },
              animate: { pathLength: [0, 1], opacity: [0, 1] },
            }}
          />
          <motion.path
            animate={controls}
            d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"
            transition={{ duration: 0.4, ease: "easeOut" }}
            variants={{
              normal: { pathLength: 1 },
              animate: { pathLength: [0, 1] },
            }}
          />
          <motion.path
            animate={controls}
            d="M6 8h2"
            transition={{ duration: 0.3, delay: 0.05, ease: "easeOut" }}
            variants={{
              normal: { pathLength: 1, opacity: 1 },
              animate: { pathLength: [0, 1], opacity: [0, 1] },
            }}
          />
          <motion.path
            animate={controls}
            d="M6 12h2"
            transition={{ duration: 0.3, delay: 0.1, ease: "easeOut" }}
            variants={{
              normal: { pathLength: 1, opacity: 1 },
              animate: { pathLength: [0, 1], opacity: [0, 1] },
            }}
          />
        </svg>
      </div>
    );
  },
);

BookOpenIcon.displayName = "BookOpenIcon";

export { BookOpenIcon };
