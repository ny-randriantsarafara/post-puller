import {
  createFingerprint,
  resolveStableTextPrefix,
  type StableTextPrefixPolicy,
} from '@extractor/capture-core/identity';

// A post without a Facebook id is stored under a hash of its author, text and
// displayed date. Both the text and the date change between two sightings of the
// same post: "See more" reveals the rest of the message, and the relative label
// moves from "2h" to "3h" as the session goes on. The fingerprint drops the date
// and keeps only the opening of the message, so it survives both.
const POST_FINGERPRINT_POLICY: StableTextPrefixPolicy = {
  minimumLength: 60,
  prefixLength: 60,
};

export async function createPostFingerprint(input: {
  authorLabel: string;
  text: string | null;
}): Promise<string | null> {
  const fingerprintText = resolveStableTextPrefix(input.text, POST_FINGERPRINT_POLICY);
  if (fingerprintText === null) {
    return null;
  }

  return createFingerprint([input.authorLabel, fingerprintText]);
}
