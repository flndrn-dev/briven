export interface ApiCallOptions {
  apiOrigin: string;
  apiKey?: string;
  method?: string;
  body?: unknown;
}

export class ApiCallError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiCallError';
  }
}

export async function apiCall<T>(path: string, options: ApiCallOptions): Promise<T> {
  const headers: Record<string, string> = {
    accept: 'application/json',
  };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.apiKey) headers['authorization'] = `Bearer ${options.apiKey}`;

  const res = await fetch(`${options.apiOrigin}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let code = 'http_error';
    let message = text || res.statusText;
    try {
      const parsed = JSON.parse(text) as { code?: string; message?: string };
      if (parsed.code) code = parsed.code;
      if (parsed.message) message = parsed.message;
    } catch {
      // leave defaults
    }
    throw new ApiCallError(res.status, code, message);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
