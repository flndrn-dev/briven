/*
 * Studio sign-in page — Phase 5 of BACKEND_FORK_BRIEF.md (screen 1 of 8).
 *
 * Studio is a passive cookie consumer per BACKEND_FORK_PLAN.md §6. All auth
 * surface lives on briven.tech. This page exists only to bounce the user to
 * the control-plane sign-in flow with a `next=` return path back to Studio.
 *
 * Local-dev fallback (IS_PLATFORM=false): skip auth, go straight to the
 * default project. Same behaviour as the upstream Studio for parity with
 * `briven dev` workflows.
 */

import type { GetServerSideProps } from 'next'

import { IS_PLATFORM } from '@/lib/constants'

const CONTROL_PLANE_ORIGIN =
  process.env.NEXT_PUBLIC_BRIVEN_WEB_ORIGIN ?? 'https://briven.tech'

export const getServerSideProps: GetServerSideProps = async ({ req, query }) => {
  if (!IS_PLATFORM) {
    return {
      redirect: { destination: '/project/default', permanent: false },
    }
  }

  const host = req.headers.host ?? 'studio.briven.tech'
  const proto = req.headers['x-forwarded-proto'] ?? 'https'
  const next =
    typeof query.next === 'string' && query.next.length > 0
      ? query.next
      : `${proto}://${host}/`

  const url = new URL('/signin', CONTROL_PLANE_ORIGIN)
  url.searchParams.set('next', next)

  return {
    redirect: { destination: url.toString(), permanent: false },
  }
}

export default function SignInPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[var(--color-bg)] px-6 text-[var(--color-text)]">
      <p className="font-mono text-sm">redirecting to briven.tech to sign in…</p>
    </main>
  )
}
