import { buildHashInput, normalizeWhitespace, sha256Hex } from './contentHash';

export type StableTextPrefixPolicy = {
  // Below this length the text cannot be proven stable, because the site may
  // have truncated it before the prefix is even complete.
  readonly minimumLength: number;
  readonly prefixLength: number;
};

const TRUNCATION_SUFFIX = /(?:\u2026|\.\.\.)$/;

// An item stored under a content hash is re-hashed differently once the site
// reveals the rest of its text, which would strand the record it already has.
// A prefix of the text survives that reveal and lets the second sighting find
// the first, so it is the fingerprint the repository looks records up by.
export function resolveStableTextPrefix(
  text: string | null,
  policy: StableTextPrefixPolicy,
): string | null {
  if (text === null) {
    return null;
  }

  const normalizedText = normalizeWhitespace(text).replace(TRUNCATION_SUFFIX, '').trimEnd();
  if (normalizedText.length < policy.minimumLength) {
    return null;
  }

  return normalizedText.slice(0, policy.prefixLength);
}

export async function createFingerprint(
  parts: readonly (string | null)[],
): Promise<string> {
  return sha256Hex(buildHashInput(parts));
}
