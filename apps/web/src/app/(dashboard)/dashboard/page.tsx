import { redirect } from 'next/navigation';

export default function DashboardHome(): never {
  redirect('/dashboard/projects');
}
