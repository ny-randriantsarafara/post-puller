import type { CapturedMessage } from './types/capturedMessage';
import type { MessageAttachment, MessageReaction } from './types/message';

function textLength(text: string | null): number {
  return text?.length ?? 0;
}

function reactionKey(reaction: MessageReaction): string {
  return reaction.emoji;
}

function attachmentKey(attachment: MessageAttachment): string {
  if (attachment.kind === 'file') {
    return `file:${attachment.caption}`;
  }

  return attachment.kind;
}

// A scan sees a message repeatedly, and a later sighting can carry reactions the
// earlier one did not - or, when the viewport moved on, fewer. Taking the union
// keeps whichever sighting saw more, per emoji.
export function mergeReactions(
  existingReactions: MessageReaction[],
  incomingReactions: MessageReaction[],
): MessageReaction[] {
  const merged = new Map<string, MessageReaction>();

  for (const reaction of [...existingReactions, ...incomingReactions]) {
    const key = reactionKey(reaction);
    const seen = merged.get(key);
    if (seen === undefined || reaction.count > seen.count) {
      merged.set(key, reaction);
    }
  }

  return [...merged.values()];
}

export function mergeAttachments(
  existingAttachments: MessageAttachment[],
  incomingAttachments: MessageAttachment[],
): MessageAttachment[] {
  const realAttachments = [...existingAttachments, ...incomingAttachments].filter(
    (attachment) => attachment.kind !== 'none',
  );

  if (realAttachments.length === 0) {
    return [{ kind: 'none' }];
  }

  const merged = new Map<string, MessageAttachment>();
  for (const attachment of realAttachments) {
    merged.set(attachmentKey(attachment), attachment);
  }

  return [...merged.values()];
}

// "Less text" is deliberately not on this list. A message unsent between two
// scans arrives empty, and treating that as a better capture would erase what
// was captured; mergeCapturedMessage handles it explicitly instead.
export function isBetterCapturedMessage(
  existingMessage: CapturedMessage,
  incomingMessage: CapturedMessage,
): boolean {
  // The point of the whole date-anchoring pass: a message first read before its
  // date separator was in view becomes resolvable a step or two later.
  if (existingMessage.sentAt === null && incomingMessage.sentAt !== null) {
    return true;
  }

  if (existingMessage.messageId === null && incomingMessage.messageId !== null) {
    return true;
  }

  if (incomingMessage.warnings.length < existingMessage.warnings.length) {
    return true;
  }

  if (textLength(incomingMessage.text) > textLength(existingMessage.text)) {
    return true;
  }

  if (incomingMessage.reactions.length > existingMessage.reactions.length) {
    return true;
  }

  if (incomingMessage.attachments.length > existingMessage.attachments.length) {
    return true;
  }

  if (existingMessage.sender === null && incomingMessage.sender !== null) {
    return true;
  }

  // An unsend is news even though it carries strictly less content.
  return !existingMessage.isUnsent && incomingMessage.isUnsent;
}

export function mergeCapturedMessage(
  existingMessage: CapturedMessage,
  incomingMessage: CapturedMessage,
): CapturedMessage {
  const isUnsent = existingMessage.isUnsent || incomingMessage.isUnsent;
  const keepIncomingText =
    textLength(incomingMessage.text) >= textLength(existingMessage.text);

  return {
    ...existingMessage,
    ...incomingMessage,
    // What was captured before an unsend is the only record that it existed, so
    // the longer of the two texts is kept and the unsend is recorded as a flag.
    text: keepIncomingText ? incomingMessage.text : existingMessage.text,
    isUnsent,
    warnings: isUnsent
      ? [...new Set([...incomingMessage.warnings, 'UNSENT_AFTER_CAPTURE' as const])]
      : incomingMessage.warnings,
    sentAt: incomingMessage.sentAt ?? existingMessage.sentAt,
    sortKey:
      incomingMessage.sentAt === null ? existingMessage.sortKey : incomingMessage.sortKey,
    messageId: incomingMessage.messageId ?? existingMessage.messageId,
    sender: incomingMessage.sender ?? existingMessage.sender,
    reactions: mergeReactions(existingMessage.reactions, incomingMessage.reactions),
    attachments: mergeAttachments(
      existingMessage.attachments,
      incomingMessage.attachments,
    ),
  };
}

// A message with no id and no content has nothing to be recognised by, and
// storing it would let one blank overwrite another under the same hash.
export function isIdentifiableCapturedMessage(message: CapturedMessage): boolean {
  if (message.identitySource !== 'contentHash') {
    return true;
  }

  if (message.sender !== null) {
    return true;
  }

  return message.text !== null && message.text.trim().length > 0;
}
