import { ZapIcon } from '@/components/ui/zap';

import { CockpitPlaceholder } from '../placeholder';

export const metadata = { title: 'launch controls · admin' };

export default function AdminLaunchPage() {
  return (
    <CockpitPlaceholder
      title="launch controls"
      icon={<ZapIcon size={20} />}
      blurb="the go-live switchboard — feature flags, signup gates, maintenance mode, and staged rollouts."
    />
  );
}
