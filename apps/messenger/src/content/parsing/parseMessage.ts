import type {
  MessageAttachment,
  MessageReaction,
  MessageSender,
  ParsedMessage,
} from '../../shared/types/message';
import type { MessageWarning } from '../../shared/types/warnings';
import { parseMessageTimestamp } from './parseMessageTimestamp';
import {
  MESSAGE_ID_PATTERNS,
  MESSAGE_LABEL,
  REACTION_LABEL,
  REJECTED_ID_PATTERNS,
  SELECTORS,
  SELF_SENDER_NAMES,
  SENT_MESSAGE_LABEL,
} from './selectors';

type MessageLabelParts = {
  displayedAt: string;
  senderName: string;
  text: string | null;
};

// The row label and the bubble label carry the same three facts in a different
// word order. Reading both means a change to either one alone is survivable.
function parseMessageLabel(element: Element): MessageLabelParts | null {
  const rowLabel = element.getAttribute('aria-label');
  const bubbleLabel = element
    .querySelector(`[aria-label^="Enter, Message sent "]`)
    ?.getAttribute('aria-label');

  for (const [label, pattern] of [
    [rowLabel, MESSAGE_LABEL],
    [bubbleLabel, SENT_MESSAGE_LABEL],
  ] as const) {
    if (label === null || label === undefined) {
      continue;
    }

    const match = pattern.exec(label);
    if (match === null) {
      continue;
    }

    const displayedAt = match[1];
    const senderName = match[2];
    if (displayedAt === undefined || senderName === undefined) {
      continue;
    }

    return { displayedAt, senderName, text: match[3] ?? null };
  }

  return null;
}

function parseSender(senderName: string): MessageSender {
  if (SELF_SENDER_NAMES.includes(senderName)) {
    return { kind: 'self' };
  }

  return { kind: 'other', name: senderName };
}

function parseMessageId(element: Element): {
  messageId: string | null;
  warning: MessageWarning | null;
} {
  const rawId = element.getAttribute('data-message-id');
  if (rawId === null || rawId.length === 0) {
    return { messageId: null, warning: 'MISSING_MESSAGE_ID' };
  }

  if (REJECTED_ID_PATTERNS.some((pattern) => pattern.test(rawId))) {
    return { messageId: null, warning: 'REJECTED_MESSAGE_ID' };
  }

  if (!MESSAGE_ID_PATTERNS.some((pattern) => pattern.test(rawId))) {
    return { messageId: null, warning: 'REJECTED_MESSAGE_ID' };
  }

  return { messageId: rawId, warning: null };
}

function parseReactions(element: Element): MessageReaction[] {
  return [...element.querySelectorAll(SELECTORS.reactionButton)].flatMap((button) => {
    const label = button.getAttribute('aria-label');
    if (label === null) {
      return [];
    }

    const match = REACTION_LABEL.exec(label);
    const rawCount = match?.[1];
    const emoji = match?.[2];
    if (rawCount === undefined || emoji === undefined) {
      return [];
    }

    const count = Number(rawCount.replace(/[^\d]/g, ''));
    if (!Number.isFinite(count) || count === 0) {
      return [];
    }

    return [{ count, emoji }];
  });
}

function parseAttachments(element: Element): MessageAttachment[] {
  const files = [...element.querySelectorAll(SELECTORS.attachmentLink)].map(
    (link): MessageAttachment => ({
      kind: 'file',
      caption: (link.getAttribute('aria-label') ?? '').replace(
        /^Open attachment,\s*/,
        '',
      ),
    }),
  );

  const stories = [...element.querySelectorAll(SELECTORS.storyLink)].map(
    (): MessageAttachment => ({ kind: 'story' }),
  );

  const attachments = [...files, ...stories];
  if (attachments.length === 0) {
    return [{ kind: 'none' }];
  }

  return attachments;
}

export function parseMessage(element: Element, referenceDate: Date): ParsedMessage {
  const { messageId, warning: idWarning } = parseMessageId(element);
  const label = parseMessageLabel(element);
  const timestamp = parseMessageTimestamp(label?.displayedAt ?? null, referenceDate);

  const warnings: MessageWarning[] = [
    idWarning,
    label === null ? 'MISSING_SENDER' : null,
    label === null ? 'MISSING_TIMESTAMP' : null,
    label !== null && !timestamp.parsed ? 'UNPARSED_TIMESTAMP' : null,
    timestamp.inferred ? 'INFERRED_TIMESTAMP' : null,
    label?.text === null || label?.text === undefined ? 'MISSING_TEXT' : null,
  ].filter((warning): warning is MessageWarning => warning !== null);

  return {
    messageId,
    sender: label === null ? null : parseSender(label.senderName),
    displayedAt: label?.displayedAt ?? null,
    sentAt: timestamp.sentAt,
    text: label?.text ?? null,
    isReply: element.querySelector(SELECTORS.repliedMessageButton) !== null,
    reactions: parseReactions(element),
    attachments: parseAttachments(element),
    warnings,
  };
}

// Placeholders are rows Messenger has recycled: they carry no id and no label,
// and reading them would produce a thread full of blanks.
export function findMessageElements(root: ParentNode): Element[] {
  return [...root.querySelectorAll(SELECTORS.messageRow)].filter(
    (element) => element.closest(SELECTORS.virtualizedPlaceholder) === null,
  );
}
