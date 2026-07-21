import { AuthBlankPanel } from '../blank-panel';

export const metadata = { title: 'Briven Auth · domains' };

export default function AuthDomainsPage() {
  return (
    <AuthBlankPanel
      title="domains"
      body="allowed app origins (your project URLs). magic links and cookies need these so login opens on your site, not a bare API page."
    />
  );
}
