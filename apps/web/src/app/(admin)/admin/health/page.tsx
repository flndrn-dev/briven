import { CockpitPlaceholder } from '../placeholder';

export const metadata = { title: 'platform health · admin' };

export default function AdminHealthPage() {
  return (
    <CockpitPlaceholder
      title="platform health"
      blurb="live signal on the engine — uptime, latency, error rates, and queue depth across every briven service."
    />
  );
}
