/**
 * Merge briven-owned keys into a .env.local style file. Preserves
 * user-set keys and comments; only updates keys whose name appears in
 * the `updates` record. Returns the new full content.
 */
export function mergeEnvFile(existing: string, updates: Record<string, string>): string {
  const updateKeys = new Set(Object.keys(updates));
  const lines = existing.split('\n');
  const out: string[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=/);
    if (match && updateKeys.has(match[1]!)) {
      const key = match[1]!;
      out.push(`${key}=${quote(updates[key]!)}`);
      seen.add(key);
    } else {
      out.push(line);
    }
  }

  // Strip the synthetic trailing empty line from split('\n') so we
  // don't accumulate blank lines across merges.
  if (out.length > 0 && out[out.length - 1] === '') out.pop();

  for (const key of updateKeys) {
    if (!seen.has(key)) {
      out.push(`${key}=${quote(updates[key]!)}`);
    }
  }

  return out.join('\n') + '\n';
}

function quote(value: string): string {
  // Always quote — keeps the file readable + avoids parsing edge cases
  // when values contain spaces or shell-special chars.
  const escaped = value.replace(/"/g, '\\"');
  return `"${escaped}"`;
}
