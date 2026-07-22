import { redirect } from 'next/navigation';

/** All former Auth sub-routes collapse to the blank Auth home. */
export default function AuthRedirectToBlank() {
  redirect('/dashboard/auth');
}
