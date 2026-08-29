export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export async function sha256Hex(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  const bytes = Array.from(new Uint8Array(digest));
  return bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

// Which parts identify an item is a domain decision: a group post is its author,
// text and displayed date, while a message needs its thread and timestamp too.
// A missing part still occupies its slot, so dropping a value cannot make one
// item hash like another that genuinely has a different shape.
export function buildHashInput(parts: readonly (string | null)[]): string {
  return parts.map((part) => (part === null ? '' : normalizeWhitespace(part))).join('\n');
}

export async function createContentHash(
  parts: readonly (string | null)[],
): Promise<string> {
  return sha256Hex(buildHashInput(parts));
}
