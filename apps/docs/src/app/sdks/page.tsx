import { DocsShell } from '../../components/shell';

export const metadata = { title: 'client sdks' };

interface Sdk {
  pkg: string;
  framework: string;
  pitch: string;
  setup: string;
  useExample: string;
  notes?: string;
}

const SDKS: readonly Sdk[] = [
  {
    pkg: '@briven/react',
    framework: 'react',
    pitch:
      'reference client. `useQuery` re-runs on row changes via the realtime WS; `useMutation` is the same shape as TanStack Query so the api curve is short.',
    setup: `import { BrivenProvider, createClient } from '@briven/react';

const client = createClient({
  url: 'https://api.briven.tech',
  projectId: 'p_xxx',
  apiKey: process.env.NEXT_PUBLIC_BRIVEN_KEY,
});

export function Providers({ children }: { children: React.ReactNode }) {
  return <BrivenProvider client={client}>{children}</BrivenProvider>;
}`,
    useExample: `'use client';
import { useQuery, useMutation } from '@briven/react';

export function Notes() {
  const { data, isLoading, error } = useQuery<'listNotes', { id: string; body: string }[]>(
    'listNotes',
    {},
  );
  const create = useMutation<'createNote', { body: string }, { id: string }>('createNote');

  if (isLoading) return <p>loading…</p>;
  if (error) return <p>{error.message}</p>;
  return (
    <>
      <button onClick={() => create.mutate({ body: 'hello' })}>add</button>
      <ul>{data?.map((n) => <li key={n.id}>{n.body}</li>)}</ul>
    </>
  );
}`,
    notes:
      'useQuery accepts a stable args object — pass primitives, not new objects on every render, or the subscription identity will churn.',
  },
  {
    pkg: '@briven/svelte',
    framework: 'svelte 5',
    pitch:
      "queries return a Readable store that fires while you're subscribed; the WS closes when the last consumer drops. svelte's reference-counted store contract does the lifecycle for us.",
    setup: `import { setBrivenClient, createClient } from '@briven/svelte';

const client = createClient({
  url: 'https://api.briven.tech',
  projectId: 'p_xxx',
  apiKey: import.meta.env.VITE_BRIVEN_KEY,
});

setBrivenClient(client);`,
    useExample: `<script lang="ts">
  import { query, mutation } from '@briven/svelte';
  const notes = query<'listNotes', { id: string; body: string }[]>('listNotes', {});
  const create = mutation<'createNote', { body: string }, { id: string }>('createNote');
</script>

{#if $notes.isLoading}loading…{/if}
{#if $notes.error}{$notes.error.message}{/if}
<button onclick={() => create.mutate({ body: 'hello' })}>add</button>
<ul>
  {#each $notes.data ?? [] as n (n.id)}<li>{n.body}</li>{/each}
</ul>`,
  },
  {
    pkg: '@briven/vue',
    framework: 'vue 3',
    pitch:
      'composables version of the same surface. `useQuery` returns refs; `watch(stableKey(args))` re-subscribes when arg identity changes. `onScopeDispose` closes the sub on component unmount.',
    setup: `// main.ts
import { createApp } from 'vue';
import { setBrivenClient, createClient } from '@briven/vue';

const client = createClient({
  url: 'https://api.briven.tech',
  projectId: 'p_xxx',
  apiKey: import.meta.env.VITE_BRIVEN_KEY,
});

setBrivenClient(client);
createApp(App).mount('#app');`,
    useExample: `<script setup lang="ts">
import { useQuery, useMutation } from '@briven/vue';
const { data, isLoading, error } = useQuery<'listNotes', { id: string; body: string }[]>(
  'listNotes',
  {},
);
const { mutate } = useMutation<'createNote', { body: string }, { id: string }>('createNote');
</script>

<template>
  <p v-if="isLoading">loading…</p>
  <p v-else-if="error">{{ error.message }}</p>
  <button @click="mutate({ body: 'hello' })">add</button>
  <ul><li v-for="n in data ?? []" :key="n.id">{{ n.body }}</li></ul>
</template>`,
  },
];

export default function SdkPage() {
  return (
    <DocsShell>
      <h1 className="font-mono text-2xl tracking-tight">client sdks</h1>
      <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
        three first-party clients with the same surface across react, svelte, and vue. each
        manages the realtime websocket lifecycle for you — subscribe on first read, re-run
        on row changes, close when the last consumer drops. you don&apos;t talk to the WS
        directly.
      </p>

      <nav className="mt-6 flex flex-wrap gap-2 font-mono text-xs">
        {SDKS.map((s) => (
          <a
            key={s.pkg}
            href={`#${encodeURIComponent(s.pkg)}`}
            className="rounded-md border border-[var(--color-border)] px-3 py-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            {s.pkg}
          </a>
        ))}
      </nav>

      <section className="mt-8 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 font-mono text-xs text-[var(--color-text-muted)]">
        <strong className="text-[var(--color-text)]">key shape:</strong> the api key lives on
        the client. browser clients use a <code>readonly</code>-scope key (
        <code>brk_</code>); server SDKs / SSR use a <code>developer</code>-scope key.
        rotate via the api keys tab in your project — old keys revoke immediately.
      </section>

      {SDKS.map((s) => (
        <section
          key={s.pkg}
          id={s.pkg}
          className="mt-10 scroll-mt-20 border-t border-[var(--color-border-subtle)] pt-8"
        >
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-mono text-lg tracking-tight">
              <code>{s.pkg}</code>
            </h2>
            <span className="font-mono text-xs text-[var(--color-text-subtle)]">{s.framework}</span>
          </div>
          <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">{s.pitch}</p>

          <h3 className="mt-5 font-mono text-sm">setup</h3>
          <pre className="mt-2 overflow-x-auto rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-code-bg)] p-3 font-mono text-xs text-[var(--color-code-text)]">
            <code>{s.setup}</code>
          </pre>

          <h3 className="mt-5 font-mono text-sm">use</h3>
          <pre className="mt-2 overflow-x-auto rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-code-bg)] p-3 font-mono text-xs text-[var(--color-code-text)]">
            <code>{s.useExample}</code>
          </pre>

          {s.notes ? (
            <p className="mt-3 font-mono text-xs text-[var(--color-text-subtle)]">
              <span className="text-[var(--color-text)]">note: </span>
              {s.notes}
            </p>
          ) : null}
        </section>
      ))}
    </DocsShell>
  );
}
