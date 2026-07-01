import { useCallback } from "react";
export function track(event: string, props?: Record<string, unknown>) {
  if (typeof window !== "undefined") {
    // Placeholder: send to briven analytics
    console.debug("[track]", event, props);
  }
}
export function useTrack() {
  return useCallback((event: string, props?: Record<string, unknown>) => {
    track(event, props);
  }, []);
}
