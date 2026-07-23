import { redirect } from 'next/navigation';

export default function AuthKeysRedirect() {
  redirect('/dashboard/auth');
}
