import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ButtonHTMLAttributes } from 'react';

import { cn } from '../lib/cn.js';

const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 whitespace-nowrap',
    'rounded-[var(--radius-md)] font-medium',
    'transition-[background-color,border-color,color,box-shadow] duration-[var(--duration-fast)] ease-[var(--ease-briven)]',
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]',
    'disabled:pointer-events-none disabled:opacity-50',
  ].join(' '),
  {
    variants: {
      variant: {
        primary: [
          'bg-[var(--color-primary)] text-[var(--color-text-inverse)]',
          'hover:bg-[var(--color-primary-hover)] active:bg-[var(--color-primary-pressed)]',
          'shadow-[var(--shadow-sm)]',
        ].join(' '),
        outline: [
          'border border-[var(--color-border)] bg-transparent text-[var(--color-text)]',
          'hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-raised)]',
        ].join(' '),
        ghost: [
          'bg-transparent text-[var(--color-text)]',
          'hover:bg-[var(--color-primary-ghost)]',
        ].join(' '),
        danger: [
          'bg-[var(--color-error)] text-[var(--color-text-inverse)]',
          'hover:opacity-90',
        ].join(' '),
      },
      size: {
        sm: 'h-8 px-3 text-[var(--text-small)]',
        md: 'h-10 px-4 text-[var(--text-body)]',
        lg: 'h-12 px-6 text-[var(--text-body)]',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, ...rest },
  ref,
) {
  return (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...rest} />
  );
});
