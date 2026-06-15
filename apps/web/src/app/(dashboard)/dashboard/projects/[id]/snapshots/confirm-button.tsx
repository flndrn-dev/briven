'use client';

/**
 * Submit button that asks for confirmation before letting the parent <form>'s
 * server action run. Used for destructive snapshot actions (restore replaces
 * all data; delete is permanent) so a non-coder can't trigger them by accident.
 */
export function ConfirmButton({
  message,
  className,
  children,
}: {
  message: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="submit"
      className={className}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
