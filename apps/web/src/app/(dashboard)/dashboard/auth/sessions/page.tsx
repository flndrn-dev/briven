import { redirect } from 'next/navigation';

export default function AuthSessionsRedirect() {
  redirect('/dashboard/auth');
}
