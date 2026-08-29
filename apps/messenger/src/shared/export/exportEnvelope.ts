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

export type ThreadExportFile = {
  fileName: string;
  envelope: ThreadExportEnvelope;
};

function hasWarning(
  messages: readonly CapturedMessage[],
  warning: CapturedMessage['warnings'][number],
): boolean {
  return messages.some((message) => message.warnings.includes(warning));
}

function buildWarnings(
  thread: CapturedThread,
  messages: readonly CapturedMessage[],
): ExportWarning[] {
  const warnings: ExportWarning[] = [];

  if (!thread.reachedThreadStart) {
    warnings.push('INCOMPLETE_HISTORY');
  }

  if (thread.isEncryptedThread) {
    warnings.push('ENCRYPTED_THREAD');
  }

  if (messages.some((message) => message.sentAt === null)) {
    warnings.push('UNRESOLVED_TIMESTAMPS');
  }

  if (hasWarning(messages, 'INFERRED_TIMESTAMP')) {
    warnings.push('INFERRED_TIMESTAMPS');
  }

  if (hasWarning(messages, 'UNSTABLE_IDENTITY')) {
    warnings.push('UNSTABLE_IDENTITIES');
  }

  return warnings;
}

function countAttachments(messages: readonly CapturedMessage[]): number {
  return messages.reduce(
    (total, message) =>
      total +
      message.attachments.filter((attachment) => attachment.kind !== 'none').length,
    0,
  );
}

// Only resolved dates bound the conversation. An unresolved message sorts to the
// end of the thread, and letting it stand in for the newest message would report
// a window the conversation never had.
function buildConversationWindow(
  messages: readonly CapturedMessage[],
): ThreadExportEnvelope['conversationWindow'] {
  const sentInstants = messages
    .map((message) => message.sentAt)
    .filter((sentAt): sentAt is string => sentAt !== null)
    .sort((left, right) => left.localeCompare(right));

  return {
    earliest: sentInstants.at(0) ?? null,
    latest: sentInstants.at(-1) ?? null,
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

export function buildThreadExportEnvelope(
  thread: CapturedThread,
  messages: readonly CapturedMessage[],
  extensionVersion: string,
  exportedAt: string,
): ThreadExportEnvelope {
  const orderedMessages = [...messages].sort((left, right) =>
    left.sortKey.localeCompare(right.sortKey),
  );

  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    extensionVersion,
    exportedAt,
    thread,
    conversationWindow: buildConversationWindow(orderedMessages),
    stats: {
      messageCount: orderedMessages.length,
      incompleteMessageCount: orderedMessages.filter(
        (message) => message.warnings.length > 0,
      ).length,
      unresolvedTimestampCount: orderedMessages.filter(
        (message) => message.sentAt === null,
      ).length,
      reactionCount: orderedMessages.reduce(
        (total, message) => total + message.reactions.length,
        0,
      ),
      attachmentCount: countAttachments(orderedMessages),
    },
    warnings: buildWarnings(thread, orderedMessages),
    messages: orderedMessages,
  };
}

export function buildThreadExport(
  thread: CapturedThread,
  messages: readonly CapturedMessage[],
  extensionVersion: string,
  exportedAt: string,
): ThreadExportFile {
  const envelope = buildThreadExportEnvelope(
    thread,
    messages,
    extensionVersion,
    exportedAt,
  );

  return {
    fileName: buildThreadExportFileName(
      thread,
      envelope.conversationWindow,
      exportedAt,
    ),
    envelope,
  };
}

export function serializeExportEnvelope(envelope: ThreadExportEnvelope): string {
  return `${JSON.stringify(envelope, null, 2)}\n`;
}
