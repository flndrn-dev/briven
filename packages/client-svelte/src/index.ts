/**
 * @briven/svelte — Svelte stores for briven.
 *
 *   import { setBrivenClient, query, mutation } from '@briven/svelte';
 *   import { createBrivenClient } from '@briven/client';
 *
 *   // once at app boot
 *   setBrivenClient(createBrivenClient({
 *     projectId: 'p_...',
 *     apiOrigin: 'https://api.briven.cloud',
 *     wsOrigin:  'wss://ws.briven.cloud',
 *     token:     () => session.token,
 *   }));
 *
 *   <script lang="ts">
 *     import { query, mutation } from '@briven/svelte';
 *
 *     const notes = query<Note[]>('listNotes', { userId });
 *     const addNote = mutation<{ body: string }, Note>('addNote');
 *   </script>
 *
 *   {#if $notes.isLoading}loading…
 *   {:else if $notes.error}{$notes.error.message}
 *   {:else}
 *     {#each $notes.data ?? [] as n}<li>{n.body}</li>{/each}
 *   {/if}
 *
 * Re-fetch + unsubscribe lifecycle is automatic — the store closes its
 * subscription when no Svelte component is subscribed (reference-counted
 * by Svelte's store contract).
 */

import { readable, writable, type Readable } from 'svelte/store';

import type { BrivenClient, InvokeFrame, SubscribeHandle } from '@briven/client';

let activeClient: BrivenClient | null = null;

/**
 * Set the BrivenClient instance every store will use. Call once at app
 * boot. Throws if called more than once with a different client (avoids
 * accidental re-init in HMR).
 */
export function setBrivenClient(client: BrivenClient): void {
  if (activeClient && activeClient !== client) {
    throw new Error(
      'setBrivenClient called twice with different clients — call it once at boot',
    );
  }
  activeClient = client;
}

export function getBrivenClient(): BrivenClient {
  if (!activeClient) {
    throw new Error(
      'no BrivenClient set — call setBrivenClient(createBrivenClient({...})) at app boot',
    );
  }
  return activeClient;
}

export interface QueryState<T> {
  readonly data: T | undefined;
  readonly error: { code: string; message: string } | undefined;
  readonly isLoading: boolean;
  readonly durationMs: number | undefined;
}

/**
 * Subscribe to a briven function. Returns a Svelte readable store that
 * starts subscribing on first $-bind and unsubscribes when the last
 * subscriber drops away.
 */
export function query<TResult = unknown>(
  functionName: string,
  args: unknown = {},
): Readable<QueryState<TResult>> {
  const client = getBrivenClient();
  return readable<QueryState<TResult>>(
    { data: undefined, error: undefined, isLoading: true, durationMs: undefined },
    (set) => {
      let cancelled = false;
      const handle: SubscribeHandle = client.subscribe(
        functionName,
        args,
        (frame: InvokeFrame) => {
          if (cancelled) return;
          if (frame.ok) {
            set({
              data: frame.value as TResult,
              error: undefined,
              isLoading: false,
              durationMs: frame.durationMs,
            });
          } else {
            set({
              data: undefined,
              error: { code: frame.code, message: frame.message },
              isLoading: false,
              durationMs: frame.durationMs,
            });
          }
        },
      );
      return () => {
        cancelled = true;
        handle.close();
      };
    },
  );
}

export interface MutationState<TResult> {
  readonly isPending: boolean;
  readonly error: { code: string; message: string } | undefined;
  readonly data: TResult | undefined;
}

export interface MutationStore<TArgs, TResult> extends Readable<MutationState<TResult>> {
  mutate(args: TArgs): Promise<TResult | undefined>;
  reset(): void;
}

/**
 * One-shot mutation over HTTP. Use the returned store's `.mutate(args)`
 * to fire the call; its state stream gives you `isPending` / `error` /
 * `data` for the UI. Mutations don't auto-subscribe — reactive queries
 * affected by the write receive their own fresh frames via the
 * realtime LISTEN/NOTIFY pipeline.
 */
export function mutation<TArgs = unknown, TResult = unknown>(
  functionName: string,
): MutationStore<TArgs, TResult> {
  const client = getBrivenClient();
  const initial: MutationState<TResult> = {
    isPending: false,
    error: undefined,
    data: undefined,
  };
  const store = writable<MutationState<TResult>>(initial);

  async function mutate(args: TArgs): Promise<TResult | undefined> {
    store.set({ isPending: true, error: undefined, data: undefined });
    const frame = await client.invoke(functionName, args);
    if (frame.ok) {
      const value = frame.value as TResult;
      store.set({ isPending: false, error: undefined, data: value });
      return value;
    }
    store.set({
      isPending: false,
      error: { code: frame.code, message: frame.message },
      data: undefined,
    });
    return undefined;
  }

  function reset(): void {
    store.set(initial);
  }

  return {
    subscribe: store.subscribe,
    mutate,
    reset,
  };
}
