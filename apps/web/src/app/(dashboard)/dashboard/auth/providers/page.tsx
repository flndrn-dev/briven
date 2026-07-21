import { AuthBlankPanel } from '../blank-panel';

export const metadata = { title: 'Briven Auth · providers' };

export default function AuthProvidersPage() {
  return (
    <AuthBlankPanel
      title="providers"
      body="password, magic link, email OTP, passkeys, Google, GitHub, Konnos, and more — with saves that stick and show live status after save."
    />
  );
}
