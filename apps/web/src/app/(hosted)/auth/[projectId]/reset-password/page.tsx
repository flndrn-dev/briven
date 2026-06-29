import { ResetPasswordForm } from './reset-password-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'auth · reset password' };

/**
 * Hosted password-reset request page. Tenant sends their email; Better Auth
 * calls `sendResetPassword` (auth-mailer.ts) which emails a link to
 * `/auth/<projectId>/new-password?token=<token>`.
 *
 * POST target: POST /api/v1/auth-tenant/request-password-reset
 *   { email: string; redirectTo: string }
 * The `redirectTo` value (new-password page URL) is constructed client-side
 * so it picks up the correct origin in dev and prod.
 */
export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <ResetPasswordForm projectId={projectId} />;
}
