import { NewPasswordForm } from './new-password-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'auth · set new password' };

/**
 * Hosted new-password page. Better Auth builds the reset email URL as:
 *   `${redirectTo}?token=<token>`
 * where `redirectTo` is the value the reset-password form passes
 * (`/auth/<projectId>/new-password`). This page reads `?token=` and
 * hands it to the client-side form.
 *
 * POST target: POST /api/v1/auth-tenant/reset-password
 *   { token: string; newPassword: string }
 */
export default async function NewPasswordPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { projectId } = await params;
  const { token = '' } = await searchParams;
  return <NewPasswordForm projectId={projectId} token={token} />;
}
