/**
 * @briven/vue — Vue 3 composables for briven.
 *
 *   import { setBrivenClient, useQuery, useMutation } from '@briven/vue';
 *   import { createBrivenClient } from '@briven/client';
 *
 *   // once at app boot, before app.mount()
 *   setBrivenClient(createBrivenClient({
 *     projectId: 'p_...',
 *     apiOrigin: 'https://api.briven.cloud',
 *     wsOrigin:  'wss://ws.briven.cloud',
 *     token:     () => session.token,
 *   }));
 *
 *   <script setup lang="ts">
 *     import { useQuery, useMutation } from '@briven/vue';
 *
 *     const { data, error, isLoading } = useQuery<Note[]>('listNotes', { userId });
 *     const addNote = useMutation<{ body: string }, Note>('addNote');
 *   </script>
 *
 *   <template>
 *     <p v-if="isLoading">loading…</p>
 *     <p v-else-if="error">{{ error.message }}</p>
 *     <li v-for="n in data ?? []" :key="n.id">{{ n.body }}</li>
 *   </template>
 */

import { onScopeDispose, ref, watch, type Ref } from 'vue';

import type { BrivenClient, InvokeFrame, SubscribeHandle } from '@briven/client';

let activeClient: BrivenClient | null = null;

/**
 * Set the BrivenClient instance every composable will use. Call once at
 * app boot, before `app.mount()`. Throws if called more than once with
 * a different client (avoids accidental re-init in HMR).
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

export interface UseQueryResult<T> {
  readonly data: Ref<T | undefined>;
  readonly error: Ref<{ code: string; message: string } | undefined>;
  readonly isLoading: Ref<boolean>;
  readonly durationMs: Ref<number | undefined>;
  /** Force a re-fetch outside the normal subscription cycle. */
  refetch(): void;
}

/**
 * Subscribe to a briven function. The returned refs update on initial
 * value and on every push from realtime when an underlying table
 * changes. Subscription closes on `onScopeDispose` (when the component
 * unmounts).
 */
export function useQuery<TResult = unknown>(
  functionName: string,
  args: unknown = {},
): UseQueryResult<TResult> {
  const client = getBrivenClient();
  const data = ref<TResult | undefined>(undefined) as Ref<TResult | undefined>;
  const error = ref<{ code: string; message: string } | undefined>(undefined);
  const isLoading = ref<boolean>(true);
  const durationMs = ref<number | undefined>(undefined);

  let handle: SubscribeHandle | null = null;
  let cancelled = false;

  function start(): void {
    cancelled = false;
    isLoading.value = true;
    error.value = undefined;
    handle = client.subscribe(functionName, args, (frame: InvokeFrame) => {
      if (cancelled) return;
      if (frame.ok) {
        data.value = frame.value as TResult;
        error.value = undefined;
        isLoading.value = false;
        durationMs.value = frame.durationMs;
      } else {
        error.value = { code: frame.code, message: frame.message };
        isLoading.value = false;
        durationMs.value = frame.durationMs;
      }
    });
  }

  function stop(): void {
    cancelled = true;
    handle?.close();
    handle = null;
  }

  start();

  // Re-subscribe if `args` is a reactive ref/object that the caller
  // wants the query to track. Watch the JSON-stable shape so adding
  // unrelated keys doesn't cycle.
  watch(
    () => stableKey(args),
    () => {
      stop();
      start();
    },
  );

  onScopeDispose(stop);

  function refetch(): void {
    stop();
    start();
  }

  return { data, error, isLoading, durationMs, refetch };
}

export interface UseMutationResult<TArgs, TResult> {
  readonly isPending: Ref<boolean>;
  readonly error: Ref<{ code: string; message: string } | undefined>;
  readonly data: Ref<TResult | undefined>;
  mutate(args: TArgs): Promise<TResult | undefined>;
  reset(): void;
}

/**
 * One-shot mutation over HTTP. Mutations don't auto-subscribe — reactive
 * queries affected by the write receive their own fresh frames via the
 * realtime LISTEN/NOTIFY pipeline.
 */
export function useMutation<TArgs = unknown, TResult = unknown>(
  functionName: string,
): UseMutationResult<TArgs, TResult> {
  const client = getBrivenClient();
  const isPending = ref<boolean>(false);
  const error = ref<{ code: string; message: string } | undefined>(undefined);
  const data = ref<TResult | undefined>(undefined) as Ref<TResult | undefined>;

  async function mutate(args: TArgs): Promise<TResult | undefined> {
    isPending.value = true;
    error.value = undefined;
    data.value = undefined;
    const frame = await client.invoke(functionName, args);
    isPending.value = false;
    if (frame.ok) {
      data.value = frame.value as TResult;
      return frame.value as TResult;
    }
    error.value = { code: frame.code, message: frame.message };
    return undefined;
  }

  function reset(): void {
    isPending.value = false;
    error.value = undefined;
    data.value = undefined;
  }

  return { isPending, error, data, mutate, reset };
}

function stableKey(value: unknown): string {
  return JSON.stringify(value, (_, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        sorted[k] = (v as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return v;
  });
}
