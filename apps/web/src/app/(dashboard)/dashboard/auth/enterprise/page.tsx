import { redirect } from 'next/navigation';

export default function AuthEnterpriseRedirect() {
  redirect('/dashboard/auth');
}
