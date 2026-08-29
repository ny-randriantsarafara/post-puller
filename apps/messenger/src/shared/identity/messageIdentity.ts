import type { IdentityKeyPrefixes } from '@extractor/capture-core/domain';
import { resolveItemIdentity, type ResolvedIdentity } from '@extractor/capture-core/identity';
import type { MessageSender, ParsedMessage } from '../types/message';

// A message has no permalink, so the middle rung of the core ladder is unused
// here: identity is either the id Messenger puts on the row, or a hash of the
// message's content.
export const MESSAGE_IDENTITY_KEY_PREFIXES: IdentityKeyPrefixes = {
  externalId: 'msg',
  externalUrl: 'msgUrl',
  contentHash: 'msgHash',
};

export function resolveSenderKey(sender: MessageSender | null): string {
  if (sender === null) {
    return 'unknown-sender';
  }

  if (sender.kind === 'self') {
    return 'self';
  }

  return sender.name;
}

// The displayed timestamp is deliberately absent from the key. Messenger rewrites
// it as days pass - today's "16:15" becomes "Tuesday 16:15" next week - and a
// message read before its date separator scrolls into view has no date at all
// until a later flush supplies one. A key built on it would change under both,
// so the same message would be stored twice. Keeping it out is also what makes
// the fingerprint layer unnecessary: there is nothing volatile left to recover
// a record from, so a fingerprint could only ever merge two distinct messages
// that happen to read alike.
export async function resolveMessageIdentity(
  threadId: string,
  parsedMessage: ParsedMessage,
  duplicateIndex: number,
): Promise<ResolvedIdentity> {
  return resolveItemIdentity(MESSAGE_IDENTITY_KEY_PREFIXES, {
    externalId: parsedMessage.messageId,
    externalUrl: null,
    contentHashParts: [
      threadId,
      resolveSenderKey(parsedMessage.sender),
      parsedMessage.text,
      String(duplicateIndex),
    ],
  });
}

// Short messages repeat verbatim - "ok", "merci", a lone thumbs-up - so a hash
// of thread, sender and text alone would collapse every one of them into a
// single record. That is a silent loss, and worse than a duplicate. The counter
// below separates them by how many identical ones came before, which keeps a
// deletion from re-keying anything outside its own bucket: only later copies of
// the very same text from the very same sender shift.
export class DuplicateMessageIndex {
  // Nothing else accumulates in the content script over a long scan, so this map
  // is the one thing that has to be bounded.
  private readonly maximumBuckets: number;
  private readonly countsByBucket = new Map<string, number>();
  private isExhausted = false;

  constructor(maximumBuckets: number) {
    this.maximumBuckets = maximumBuckets;
  }

  get hasOverflowed(): boolean {
    return this.isExhausted;
  }

  // A message that already carries an id never consults this, so the bucket is
  // only ever built for the messages that actually need one.
  next(threadId: string, parsedMessage: ParsedMessage): number | null {
    const bucket = [
      threadId,
      resolveSenderKey(parsedMessage.sender),
      parsedMessage.text ?? '',
    ].join('\u0000');

    const seenCount = this.countsByBucket.get(bucket);
    if (seenCount !== undefined) {
      this.countsByBucket.set(bucket, seenCount + 1);
      return seenCount + 1;
    }

    if (this.countsByBucket.size >= this.maximumBuckets) {
      this.isExhausted = true;
      return null;
    }

    this.countsByBucket.set(bucket, 0);
    return 0;
  }
}
