import { CockpitPlaceholder } from '../placeholder';

export const metadata = { title: 'mcp / agent access · admin' };

export default function AdminMcpPage() {
  return (
    <CockpitPlaceholder
      title="mcp / agent access"
      blurb="control which agents and mcp clients can reach the platform — issued keys, scopes, and recent agent activity."
    />
  );
}
