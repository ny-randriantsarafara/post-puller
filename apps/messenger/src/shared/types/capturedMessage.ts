import type { CapturedItemBase } from '@extractor/capture-core/domain';
import type {
  MessageAttachment,
  MessageReaction,
  MessageSender,
} from './message';
import type { MessageWarning } from './warnings';

export type CapturedMessage = CapturedItemBase & {
  threadId: string;
  messageId: string | null;
  sender: MessageSender | null;
  displayedAt: string | null;
  sentAt: string | null;
  // sentAt is null for any message whose date could not be resolved, and
  // IndexedDB drops a record from an index when a key path component is null.
  // Indexing on sortKey instead keeps the unresolved messages enumerable, which
  // is precisely the set most worth finding again.
  sortKey: string;
  text: string | null;
  isReply: boolean;
  isUnsent: boolean;
  reactions: MessageReaction[];
  attachments: MessageAttachment[];
  warnings: MessageWarning[];
};

// '~' sorts after every digit, so messages with no resolved date land at the end
// of the thread rather than at its start, and are addressable as a range.
export const UNRESOLVED_SORT_KEY_PREFIX = '~';

export function buildSortKey(sentAt: string | null, capturedAt: string): string {
  if (sentAt === null) {
    return `${UNRESOLVED_SORT_KEY_PREFIX}${capturedAt}`;
  }

  return sentAt;
}
