import { AuthSubNav } from './sub-nav';

/**
 * Layout for every `/auth/*` route. Renders a single sub-nav strip above
 * the route content so the operator can hop between providers / users /
 * audit / api-keys / webhooks / usage without going back to overview.
 *
 * The sub-nav is a client component (uses `usePathname` for the active
 * link); everything else stays on the server.
 */
export default async function AuthLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="flex flex-col gap-6">
      <AuthSubNav projectId={id} />
      {children}
    </div>
  );
}
