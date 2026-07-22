'use client';

import { AuthProjectsGrid } from '../auth-projects-grid';
import type { AuthV2ProjectRow } from '../lib/auth-v2-types';

/** @deprecated Prefer AuthProjectsGrid — kept for any remaining imports. */
export function AuthProjectsClient({ initial }: { initial: AuthV2ProjectRow[] }) {
  return <AuthProjectsGrid projects={initial} />;
}
