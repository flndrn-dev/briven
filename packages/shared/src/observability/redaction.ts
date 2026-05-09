const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const IPV4_RE = /\b(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}\b/g;

export function containsForbiddenContent(value: string): boolean {
  EMAIL_RE.lastIndex = 0;
  IPV4_RE.lastIndex = 0;
  return EMAIL_RE.test(value) || IPV4_RE.test(value);
}

export function redactValue<T>(value: T): T {
  if (typeof value !== 'string') return value;
  return value
    .replace(EMAIL_RE, '[REDACTED:email]')
    .replace(IPV4_RE, '[REDACTED:ip]') as unknown as T;
}
