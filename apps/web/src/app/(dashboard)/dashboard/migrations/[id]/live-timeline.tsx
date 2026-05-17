'use client';
import { useEffect, useRef, useState } from 'react';
import { clientApiJson } from '@/lib/client-api';

export function LiveMigrationTimeline({ requestId, initialStatus, initialTimeline, StepTimeline, children }: {
  requestId: string;
  initialStatus: string;
  initialTimeline: any[];
  StepTimeline: React.ComponentType<{ status: string; timeline: any[] }>;
  children: React.ReactNode;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [timeline, setTimeline] = useState(initialTimeline);
  const pollRef = useRef(null);
  useEffect(() => {
    if (status === 'completed' || status === 'cancelled') return;
    pollRef.current = setInterval(async () => {
      try {
        const data = await clientApiJson('/v1/migration-requests/' + requestId);
        setStatus(data.request.status);
        setTimeline(data.timeline);
      } catch {}
    }, 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [status, requestId]);
  return <StepTimeline status={status} timeline={timeline} />;
}
