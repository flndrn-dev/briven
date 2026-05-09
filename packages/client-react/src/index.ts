/**
 * @briven/react — React hooks for briven.
 *
 *   import { BrivenProvider, useQuery, useMutation } from '@briven/react';
 *   import { createBrivenClient } from '@briven/client';
 *
 *   const client = createBrivenClient({
 *     projectId: 'p_...',
 *     apiOrigin: 'https://api.briven.cloud',
 *     wsOrigin:  'wss://ws.briven.cloud',
 *     token:     () => session.token,
 *   });
 *
 *   <BrivenProvider client={client}>
 *     <App />
 *   </BrivenProvider>
 *
 *   function NoteList({ userId }: { userId: string }) {
 *     const { data, error, isLoading } = useQuery<Note[]>('listNotes', { userId });
 *     // re-renders automatically when any table 'listNotes' touched changes
 *   }
 */

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import type { BrivenClient, InvokeFrame, SubscribeHandle } from '@briven/client';

const Ctx = createContext<BrivenClient | null>(null);

export interface BrivenProviderProps {
  client: BrivenClient;
  children: ReactNode;
}

export function BrivenProvider({ client, children }: BrivenProviderProps) {
  return createElement(Ctx.Provider, { value: client }, children);
}

export function useBrivenClient(): BrivenClient {
  const client = useContext(Ctx);
  if (!client) {
    throw new Error('useBrivenClient must be used inside <BrivenProvider client={...}>');
  }
  return client;
}

export interface UseQueryResult<T> {
  readonly data: T | undefined;
  readonly error: { code: string; message: string } | undefined;
  readonly isLoading: boolean;
  readonly durationMs: number | undefined;
  /** Force a re-fetch outside the normal subscription cycle. */
  refetch(): void;
}

/**
 * Subscribe to a briven function. The component re-renders on the initial
 * value and on every push from realtime when an underlying table changes.
 *
 * `args` is JSON-stringified to detect changes — pass plain objects only.
 */
export function useQuery<TResult = unknown>(
  functionName: string,
  args: unknown = {},
): UseQueryResult<TResult> {
  const client = useBrivenClient();
  const [state, setState] = useState<{
    data: TResult | undefined;
    error: { code: string; message: string } | undefined;
    isLoading: boolean;
    durationMs: number | undefined;
  }>({ data: undefined, error: undefined, isLoading: true, durationMs: undefined });

  const argsKey = stableKey(args);
  const handleRef = useRef<SubscribeHandle | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, isLoading: true, error: undefined }));

    const handle = client.subscribe(functionName, args, (frame: InvokeFrame) => {
      if (cancelled) return;
      if (frame.ok) {
        setState({
          data: frame.value as TResult,
          error: undefined,
          isLoading: false,
          durationMs: frame.durationMs,
        });
      } else {
        setState((s) => ({
          ...s,
          error: { code: frame.code, message: frame.message },
          isLoading: false,
          durationMs: frame.durationMs,
        }));
      }
    });
    handleRef.current = handle;

    return () => {
      cancelled = true;
      handle.close();
      handleRef.current = null;
    };
    // argsKey captures arg shape; functionName + client identity are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, functionName, argsKey]);

  const refetch = useCallback(() => {
    handleRef.current?.close();
    setState((s) => ({ ...s, isLoading: true }));
    handleRef.current = client.subscribe(functionName, args, (frame: InvokeFrame) => {
      if (frame.ok) {
        setState({
          data: frame.value as TResult,
          error: undefined,
          isLoading: false,
          durationMs: frame.durationMs,
        });
      } else {
        setState((s) => ({
          ...s,
          error: { code: frame.code, message: frame.message },
          isLoading: false,
          durationMs: frame.durationMs,
        }));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, functionName, argsKey]);

  return { ...state, refetch };
}

export interface UseMutationResult<TArgs, TResult> {
  readonly isPending: boolean;
  readonly error: { code: string; message: string } | undefined;
  readonly data: TResult | undefined;
  mutate(args: TArgs): Promise<TResult | undefined>;
  reset(): void;
}

/**
 * One-shot mutation over HTTP. Mutations don't auto-subscribe — the
 * realtime triggers fire from the postgres side, so any open `useQuery`
 * affected by this mutation will receive a fresh frame on its own.
 */
export function useMutation<TArgs = unknown, TResult = unknown>(
  functionName: string,
): UseMutationResult<TArgs, TResult> {
  const client = useBrivenClient();
  const [state, setState] = useState<{
    isPending: boolean;
    error: { code: string; message: string } | undefined;
    data: TResult | undefined;
  }>({ isPending: false, error: undefined, data: undefined });

  const mutate = useCallback(
    async (args: TArgs): Promise<TResult | undefined> => {
      setState({ isPending: true, error: undefined, data: undefined });
      const frame = await client.invoke(functionName, args);
      if (frame.ok) {
        setState({ isPending: false, error: undefined, data: frame.value as TResult });
        return frame.value as TResult;
      }
      setState({
        isPending: false,
        error: { code: frame.code, message: frame.message },
        data: undefined,
      });
      return undefined;
    },
    [client, functionName],
  );

  const reset = useCallback(() => {
    setState({ isPending: false, error: undefined, data: undefined });
  }, []);

  return { ...state, mutate, reset };
}

function stableKey(value: unknown): string {
  // Order keys alphabetically so `{a:1, b:2}` and `{b:2, a:1}` produce
  // the same subscription identity. Cheap; not bullet-proof for cycles
  // (callers should pass plain JSON values).
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
