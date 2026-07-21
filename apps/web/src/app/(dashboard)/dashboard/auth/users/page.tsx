import { AuthBlankPanel } from '../blank-panel';

export const metadata = { title: 'Briven Auth · users' };

export default function AuthUsersPage() {
  return (
    <AuthBlankPanel
      title="users"
      body="search, ban, verify email, and manage end-users for each project — SuperTokens-style user admin inside Briven Auth."
    />
  );
}
