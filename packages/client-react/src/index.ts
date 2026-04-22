/**
 * @briven/react — React hooks for briven.
 *
 * Status: skeleton. Non-reactive `useQuery` lands in Phase 1 week 7-8 over
 * HTTP polling. Reactive `useQuery` (WebSocket) lands in Phase 2 month 1
 * alongside `apps/realtime`.
 */

import type { BrivenClient } from '@briven/client';

export interface UseQueryResult<T> {
  readonly data: T | undefined;
  readonly error: Error | undefined;
  readonly isLoading: boolean;
}

/** @throws always — not implemented in this phase */
export function useQuery<_TArgs, _TResult>(
  _name: string,
  _args: _TArgs,
): UseQueryResult<_TResult> {
  throw new Error('briven-react.useQuery: not implemented — scheduled for Phase 1 week 7-8');
}

/** @throws always — not implemented in this phase */
export function useMutation<_TArgs, _TResult>(
  _name: string,
): (args: _TArgs) => Promise<_TResult> {
  throw new Error('briven-react.useMutation: not implemented — scheduled for Phase 1 week 7-8');
}

export interface BrivenProviderProps {
  readonly client: BrivenClient;
  readonly children: unknown;
}

/** @throws always — not implemented in this phase */
export function BrivenProvider(_props: BrivenProviderProps): unknown {
  throw new Error('briven-react.BrivenProvider: not implemented — scheduled for Phase 1 week 7-8');
}
