import { notFound } from 'next/navigation';

import { HostedFlow } from './hosted-flow';

const FORM_FLOWS = ['sign-in', 'sign-up', 'magic-link', 'otp'] as const;
type FormFlow = (typeof FORM_FLOWS)[number];

function isFormFlow(value: string): value is FormFlow {
  return (FORM_FLOWS as readonly string[]).includes(value);
}

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ flow: string }>;
}) {
  const { flow } = await params;
  if (!isFormFlow(flow)) return { title: 'auth' };
  return { title: `auth · ${flow}` };
}

export default async function HostedFlowPage({
  params,
}: {
  params: Promise<{ projectId: string; flow: string }>;
}) {
  const { projectId, flow } = await params;
  if (!isFormFlow(flow)) notFound();
  return <HostedFlow projectId={projectId} flow={flow} />;
}
