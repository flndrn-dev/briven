import { redirect } from 'next/navigation';

export default function AuthProvidersRedirect() {
  redirect('/dashboard/auth');
}
