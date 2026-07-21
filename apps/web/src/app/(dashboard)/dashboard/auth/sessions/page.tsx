import { AuthBlankPanel } from '../blank-panel';

export const metadata = { title: 'Briven Auth · sessions' };

export default function AuthSessionsPage() {
  return (
    <AuthBlankPanel
      title="sessions"
      body="list devices, revoke logins, and refresh tokens — first-class session management like SuperTokens."
    />
  );
}
