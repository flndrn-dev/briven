// @ts-nocheck
import { useEffect, useRef } from 'react'

/**
 * Like useEffect but the callback is NOT invalidated when deps change.
 * The callback captured at first render is called on every dep change.
 * Useful for event handlers that should always see the latest deps
 * without being re-registered.
 */
export function useStaticEffectEvent<T extends (...args: any[]) => any>(fn: T): T {
  const ref = useRef<T>(fn)
  ref.current = fn
  const stableRef = useRef<T>()
  if (!stableRef.current) {
    stableRef.current = ((...args: any[]) => ref.current(...args)) as T
  }
  return stableRef.current
}
