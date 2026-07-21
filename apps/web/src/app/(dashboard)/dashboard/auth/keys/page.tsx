import { AuthBlankPanel } from '../blank-panel';

export const metadata = { title: 'Briven Auth · keys' };

export default function AuthKeysPage() {
  return (
    <AuthBlankPanel
      title="keys"
      body="mint and revoke pk_briven_auth_… public keys for browser apps. never put brk_ in the browser."
    />
  );
}
