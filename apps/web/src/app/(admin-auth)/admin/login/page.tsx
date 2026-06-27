import Image from 'next/image';

import { AdminLoginForm } from './login-form';

export const metadata = {
  title: 'admin sign in',
  robots: { index: false, follow: false },
};

/**
 * Bare cockpit login. Lives in the (admin-auth) route group, which is a
 * SEPARATE layout tree from (admin) — so the cockpit's auth gate does not
 * wrap this page, and an unauthenticated visitor reaching /admin/login is
 * never redirected (no loop).
 */
export default function AdminLoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[var(--color-bg)] px-6 text-[var(--color-text)]">
      <div className="w-full max-w-xs">
        <div className="mb-10 flex items-center gap-3" aria-label="briven admin">
          <Image src="/icon.svg" alt="" width={28} height={28} priority />
          <span className="font-mono text-sm">briven admin</span>
        </div>

        <h1 className="font-mono text-2xl tracking-tight">sign in</h1>

        <div className="mt-8">
          <AdminLoginForm />
        </div>
      </div>
    </main>
  );
}
