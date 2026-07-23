import { redirect } from 'next/navigation';

export default function AuthSecurityRedirect() {
  redirect('/dashboard/auth');
}
