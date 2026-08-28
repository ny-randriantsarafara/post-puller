import { normalizeWhitespace, sha256Hex } from './contentHash';

// A post without a Facebook id is stored under a hash of its author, text and
// displayed date. Both the text and the date change between two sightings of the
// same post: "See more" reveals the rest of the message, and the relative label
// moves from "2h" to "3h" as the session goes on. The fingerprint drops the date
// and keeps only the opening of the message, so it survives both.
const FINGERPRINT_TEXT_LENGTH = 60;

// A shorter message cannot be proven stable: Facebook may have truncated it
// before the prefix is complete, so those posts get no fingerprint.
function resolveFingerprintText(text: string | null): string | null {
  if (text === null) {
    return null;
  }

  const normalizedText = normalizeWhitespace(text).replace(/(?:\u2026|\.\.\.)$/, '').trimEnd();
  if (normalizedText.length < FINGERPRINT_TEXT_LENGTH) {
    return null;
  }

  return normalizedText.slice(0, FINGERPRINT_TEXT_LENGTH);
}

export function buildPostFingerprintInput(input: {
  authorLabel: string;
  text: string | null;
}): string | null {
  const fingerprintText = resolveFingerprintText(input.text);
  if (fingerprintText === null) {
    return null;
  }

  return [normalizeWhitespace(input.authorLabel), fingerprintText].join('\n');
}

export async function createPostFingerprint(input: {
  authorLabel: string;
  text: string | null;
}): Promise<string | null> {
  const payload = buildPostFingerprintInput(input);
  if (payload === null) {
    return null;
  }

  return sha256Hex(payload);
}
