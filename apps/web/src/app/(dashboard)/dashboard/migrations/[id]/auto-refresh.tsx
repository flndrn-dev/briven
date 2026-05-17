'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export function AutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(id);
  }, [active, router]);
  if (!active) return null;
  return (
    <p className="mt-4 font-mono text-[10px] text-[var(--color-primary)] text-center">
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--color-primary)] animate-pulse mr-1.5 align-middle" />
      updates in real time
    </p>
  );
}

export async function clientApiJson(path, init = {}) {
  const origin = "https://api.briven.tech";
  const url = origin + path;
  const res = await fetch(url, { ...init, headers: { "content-type": "application/json", ...init.headers }, credentials: "include" });
  if (!res.ok) throw new Error(await res.text().catch(() => ""));
  return await res.json();
}
