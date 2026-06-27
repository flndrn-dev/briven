import { CogIcon } from '@/components/ui/cog';

import { CockpitPlaceholder } from '../placeholder';

export const metadata = { title: 'settings · admin' };

export default function AdminSettingsPage() {
  return (
    <CockpitPlaceholder
      title="settings"
      icon={<CogIcon size={20} />}
      blurb="cockpit preferences and operator security — change my password lives here."
    />
  );
}
