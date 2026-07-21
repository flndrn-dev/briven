import { AuthBlankPanel } from '../blank-panel';

export const metadata = { title: 'Briven Auth · projects' };

export default function AuthProjectsPage() {
  return (
    <AuthBlankPanel
      title="projects"
      body="list every Briven project with Auth on or off, and jump into setup. enable will live here plus a small enable action on the project itself."
    />
  );
}
