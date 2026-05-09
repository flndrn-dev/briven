/**
 * Strip operational secrets from an error message before it leaves the
 * runtime per CLAUDE.md §5.1. Order matters: paths and IPs first, then
 * env-var values (which may overlap), then truncation.
 */

const TMP_PATH = /\/tmp\/briven-isolate-[a-zA-Z0-9_-]+/g;
const IPV4 = /\b(?:25[0-5]|2[0-4]\d|1\d\d|\d{1,2})(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|\d{1,2})){3}\b/g;
// IPv6: matches leading-::, mid-::, and full forms (including ::1 loopback)
const IPV6 = /::(?:[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4})*)?|[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{0,4})*::[0-9a-fA-F]{0,4}|(?:[0-9a-fA-F]{1,4}:){2,7}[0-9a-fA-F]{1,4}/g;

const MAX_CHARS = 2048;
const TRUNCATE_MARKER = '…';

export function sanitizeErrorMessage(input: string, envValues: readonly string[]): string {
  let out = input.replace(TMP_PATH, '<bundle>');
  out = out.replace(IPV4, '<ip>');
  out = out.replace(IPV6, '<ip>');
  for (const value of envValues) {
    if (value.length < 4) continue; // skip near-empty values
    out = out.split(value).join('<redacted>');
  }
  if (out.length > MAX_CHARS) {
    out = out.slice(0, MAX_CHARS - TRUNCATE_MARKER.length) + TRUNCATE_MARKER;
  }
  return out;
}
