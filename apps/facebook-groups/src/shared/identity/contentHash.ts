export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export async function sha256Hex(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  const bytes = Array.from(new Uint8Array(digest));
  return bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function buildContentHashInput(input: {
  authorLabel: string;
  text: string | null;
  displayedDate: string | null;
}): string {
  const normalizedText = input.text === null ? '' : normalizeWhitespace(input.text);
  const normalizedDate =
    input.displayedDate === null ? '' : normalizeWhitespace(input.displayedDate);
  const normalizedAuthor = normalizeWhitespace(input.authorLabel);

  return [normalizedAuthor, normalizedText, normalizedDate].join('\n');
}

export async function createContentHash(input: {
  authorLabel: string;
  text: string | null;
  displayedDate: string | null;
}): Promise<string> {
  const payload = buildContentHashInput(input);
  return sha256Hex(payload);
}
