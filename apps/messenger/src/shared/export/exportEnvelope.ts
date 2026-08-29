import type { CapturedMessage } from '../types/capturedMessage';
import type { CapturedThread } from '../types/thread';

export const EXPORT_SCHEMA_VERSION = 1;

// Flags a reader has to see, because each one means the file says less than it
// appears to. They are computed rather than stored so an export cannot drift
// from the records it was built from.
export const EXPORT_WARNINGS = [
  // Scrolling stopped before the first message of the thread.
  'INCOMPLETE_HISTORY',
  // An end-to-end encrypted conversation. The content was in the DOM and is
  // therefore in this file; nobody should discover that by accident.
  'ENCRYPTED_THREAD',
  // Some messages carry no resolved date, so ordering them is a guess.
  'UNRESOLVED_TIMESTAMPS',
  // Some messages carry only an inferred date, read against the clock of the
  // machine that captured them.
  'INFERRED_TIMESTAMPS',
  // Some messages are keyed by a hash of their content rather than by an id, so
  // a re-scan may not recognise them.
  'UNSTABLE_IDENTITIES',
] as const;

export type ExportWarning = (typeof EXPORT_WARNINGS)[number];

export type ThreadExportEnvelope = {
  schemaVersion: typeof EXPORT_SCHEMA_VERSION;
  extensionVersion: string;
  exportedAt: string;
  thread: CapturedThread;
  conversationWindow: {
    earliest: string | null;
    latest: string | null;
  };
  stats: {
    messageCount: number;
    incompleteMessageCount: number;
    unresolvedTimestampCount: number;
    reactionCount: number;
    attachmentCount: number;
  };
  warnings: ExportWarning[];
  messages: CapturedMessage[];
};

// Everything an export says about itself, which is everything but the messages.
// Held apart from them so a file can be written a page at a time.
export type ThreadExportHeader = Omit<ThreadExportEnvelope, 'messages'>;

// What the header needs from the messages, carried across pages so no page has
// to be kept. Two flags rather than the warning list, because the list is built
// in a fixed order once the whole thread has been read.
export type ThreadExportSummary = {
  readonly messageCount: number;
  readonly incompleteMessageCount: number;
  readonly unresolvedTimestampCount: number;
  readonly reactionCount: number;
  readonly attachmentCount: number;
  readonly conversationWindow: ThreadExportEnvelope['conversationWindow'];
  readonly hasInferredTimestamps: boolean;
  readonly hasUnstableIdentities: boolean;
};

export const EMPTY_THREAD_EXPORT_SUMMARY: ThreadExportSummary = {
  messageCount: 0,
  incompleteMessageCount: 0,
  unresolvedTimestampCount: 0,
  reactionCount: 0,
  attachmentCount: 0,
  conversationWindow: { earliest: null, latest: null },
  hasInferredTimestamps: false,
  hasUnstableIdentities: false,
};

function buildWarnings(
  thread: CapturedThread,
  summary: ThreadExportSummary,
): ExportWarning[] {
  const warnings: ExportWarning[] = [];

  if (!thread.reachedThreadStart) {
    warnings.push('INCOMPLETE_HISTORY');
  }

  if (thread.isEncryptedThread) {
    warnings.push('ENCRYPTED_THREAD');
  }

  if (summary.unresolvedTimestampCount > 0) {
    warnings.push('UNRESOLVED_TIMESTAMPS');
  }

  if (summary.hasInferredTimestamps) {
    warnings.push('INFERRED_TIMESTAMPS');
  }

  if (summary.hasUnstableIdentities) {
    warnings.push('UNSTABLE_IDENTITIES');
  }

  return warnings;
}

function countAttachments(message: CapturedMessage): number {
  return message.attachments.filter((attachment) => attachment.kind !== 'none').length;
}

// Only resolved dates bound the conversation. An unresolved message sorts to the
// end of the thread, and letting it stand in for the newest message would report
// a window the conversation never had.
function widenConversationWindow(
  window: ThreadExportEnvelope['conversationWindow'],
  sentAt: string | null,
): ThreadExportEnvelope['conversationWindow'] {
  if (sentAt === null) {
    return window;
  }

  return {
    earliest:
      window.earliest === null || sentAt < window.earliest ? sentAt : window.earliest,
    latest: window.latest === null || sentAt > window.latest ? sentAt : window.latest,
  };
}

function addMessageToSummary(
  summary: ThreadExportSummary,
  message: CapturedMessage,
): ThreadExportSummary {
  return {
    messageCount: summary.messageCount + 1,
    incompleteMessageCount:
      summary.incompleteMessageCount + Number(message.warnings.length > 0),
    unresolvedTimestampCount:
      summary.unresolvedTimestampCount + Number(message.sentAt === null),
    reactionCount: summary.reactionCount + message.reactions.length,
    attachmentCount: summary.attachmentCount + countAttachments(message),
    conversationWindow: widenConversationWindow(
      summary.conversationWindow,
      message.sentAt,
    ),
    hasInferredTimestamps:
      summary.hasInferredTimestamps || message.warnings.includes('INFERRED_TIMESTAMP'),
    hasUnstableIdentities:
      summary.hasUnstableIdentities || message.warnings.includes('UNSTABLE_IDENTITY'),
  };
}

// Folded page by page while the export is written, so a thread of any length
// costs one page of memory rather than all of it.
export function addMessagesToThreadExportSummary(
  summary: ThreadExportSummary,
  messages: readonly CapturedMessage[],
): ThreadExportSummary {
  return messages.reduce(addMessageToSummary, summary);
}

export function buildThreadExportHeader(
  thread: CapturedThread,
  summary: ThreadExportSummary,
  extensionVersion: string,
  exportedAt: string,
): ThreadExportHeader {
  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    extensionVersion,
    exportedAt,
    thread,
    conversationWindow: summary.conversationWindow,
    stats: {
      messageCount: summary.messageCount,
      incompleteMessageCount: summary.incompleteMessageCount,
      unresolvedTimestampCount: summary.unresolvedTimestampCount,
      reactionCount: summary.reactionCount,
      attachmentCount: summary.attachmentCount,
    },
    warnings: buildWarnings(thread, summary),
  };
}

function slugify(source: string): string {
  return source
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// A title written entirely outside the latin range slugifies to nothing, and so
// does an absent one. Falling straight to a constant would give every such
// conversation the same file name, so the thread id is tried in between.
function slugifyThreadTitle(thread: CapturedThread): string {
  const candidates = [thread.title ?? '', thread.threadId];

  for (const candidate of candidates) {
    const slug = slugify(candidate);
    if (slug.length > 0) {
      return slug;
    }
  }

  return 'thread';
}

export function buildThreadExportFileName(
  thread: CapturedThread,
  conversationWindow: ThreadExportEnvelope['conversationWindow'],
  exportedAt: string,
): string {
  const slug = slugifyThreadTitle(thread);

  if (conversationWindow.earliest !== null && conversationWindow.latest !== null) {
    return `${slug}_${conversationWindow.earliest.slice(0, 10)}_${conversationWindow.latest.slice(0, 10)}.json`;
  }

  return `${slug}_export-${exportedAt.slice(0, 10)}.json`;
}

// Codepoint order, which is the order the index the messages are paged from is
// in. A locale comparison sorts '~' — the prefix of a sort key whose date never
// resolved — before every digit, which puts the undated messages at the top of
// the file instead of the end and disagrees with the file the paged writer
// produces from the same thread.
function compareSortKeys(left: CapturedMessage, right: CapturedMessage): number {
  if (left.sortKey === right.sortKey) {
    return 0;
  }

  return left.sortKey < right.sortKey ? -1 : 1;
}

// The whole envelope in memory, for a caller that already holds every message: a
// test, or a thread short enough that a page-at-a-time export would be one page.
// It shares the fold above, so the two cannot describe the same thread
// differently.
export function buildThreadExportEnvelope(
  thread: CapturedThread,
  messages: readonly CapturedMessage[],
  extensionVersion: string,
  exportedAt: string,
): ThreadExportEnvelope {
  const orderedMessages = [...messages].sort(compareSortKeys);
  const summary = addMessagesToThreadExportSummary(
    EMPTY_THREAD_EXPORT_SUMMARY,
    orderedMessages,
  );

  return {
    ...buildThreadExportHeader(thread, summary, extensionVersion, exportedAt),
    messages: orderedMessages,
  };
}

