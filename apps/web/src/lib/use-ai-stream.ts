'use client';

import { useCallback, useRef, useState } from 'react';

/**
 * Hook for consuming the briven AI SSE streaming endpoints. The api
 * emits text/event-stream with three event types:
 *
 *   event: token        data: <chunk>       (one per token)
 *   event: done         data: {}            (terminal)
 *   event: error        data: <message>     (terminal, indicates failure)
 *
 * The hook returns:
 *   - text:    the accumulated tokens so far
 *   - status:  'idle' | 'streaming' | 'done' | 'error' | 'not_configured'
 *   - error:   the error message (when status==='error' or 'not_configured')
 *   - start:   call to kick off a stream
 *   - reset:   wipe state without making a request
 *
 * Browser EventSource doesn't support POST + bodies, so we POST with
 * fetch and read the response body as a UTF-8 stream, parsing SSE
 * frames manually.
 */

export type StreamStatus = 'idle' | 'streaming' | 'done' | 'error' | 'not_configured';

interface UseAiStreamReturn {
  text: string;
  status: StreamStatus;
  error: string | null;
  start: (url: string, body: unknown) => Promise<void>;
  reset: () => void;
}

export function useAiStream(): UseAiStreamReturn {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<StreamStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setText('');
    setStatus('idle');
    setError(null);
  }, []);

  const start = useCallback(async (url: string, body: unknown) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setText('');
    setStatus('streaming');
    setError(null);

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
        signal: ac.signal,
      });
    } catch (err) {
      if (ac.signal.aborted) return;
      setStatus('error');
      setError(err instanceof Error ? err.message : 'network error');
      return;
    }

    if (res.status === 503) {
      const errBody = (await res.json().catch(() => null)) as { message?: string } | null;
      setStatus('not_configured');
      setError(errBody?.message ?? 'AI features are disabled on this deployment');
      return;
    }
    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => '');
      setStatus('error');
      setError(errText || `request failed (${res.status})`);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let accumulated = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE frames are separated by blank lines.
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const parsed = parseFrame(frame);
          if (parsed.event === 'token' && parsed.data) {
            accumulated += unescapeJson(parsed.data);
            setText(accumulated);
          } else if (parsed.event === 'done') {
            setStatus('done');
            return;
          } else if (parsed.event === 'error') {
            setStatus('error');
            setError(parsed.data || 'stream error');
            return;
          }
        }
      }
      // Body ended without a `done` event — treat as success if we got
      // any text, otherwise as an error.
      setStatus(accumulated.length > 0 ? 'done' : 'error');
      if (accumulated.length === 0) setError('stream ended unexpectedly');
    } catch (err) {
      if (ac.signal.aborted) return;
      setStatus('error');
      setError(err instanceof Error ? err.message : 'stream read error');
    }
  }, []);

  return { text, status, error, start, reset };
}

interface ParsedFrame {
  event: string;
  data: string;
}

function parseFrame(frame: string): ParsedFrame {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) event = line.slice('event:'.length).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice('data:'.length).trim());
  }
  return { event, data: dataLines.join('\n') };
}

/** The api's SSE writer escapes data with JSON.stringify(s).slice(1,-1). Reverse. */
function unescapeJson(s: string): string {
  try {
    return JSON.parse(`"${s}"`) as string;
  } catch {
    return s;
  }
}
