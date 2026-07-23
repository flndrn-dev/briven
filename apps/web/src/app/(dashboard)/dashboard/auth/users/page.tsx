import { redirect } from 'next/navigation';

/** Old flat Auth users → pick a project on Auth home. */
export default function AuthUsersRedirect() {
  redirect('/dashboard/auth');
}
