import { createItemRepository, requestValue } from '@extractor/capture-core/storage';
import {
  ALIAS_INDEX,
  MESSAGE_STORE_NAME,
  THREAD_SORT_INDEX,
  THREAD_STORE_NAME,
  messengerDomain,
} from '../domain';
import { capturedThreadSchema } from '../messaging/protocol';
import type { CapturedMessage } from '../types/capturedMessage';
import { UNRESOLVED_SORT_KEY_PREFIX } from '../types/capturedMessage';
import type { CapturedThread, ScanStopReason } from '../types/thread';
import { reachedThreadStart } from '../types/thread';
import type { ThreadIdSource } from '../../content/threadPage';

const repository = createItemRepository(messengerDomain);

// '\uffff' sorts after every character IndexedDB will see in a sort key, so it
// closes an open-ended range on one thread.
const HIGHEST_KEY_CHARACTER = '\uffff';

export type MessagePage = {
  messages: CapturedMessage[];
  total: number;
  offset: number;
  limit: number;
};

export type ThreadScanSummary = {
  threadId: string;
  threadIdSource: ThreadIdSource;
  aliases: readonly string[];
  title: string | null;
  isEncryptedThread: boolean;
  stopReason: ScanStopReason;
  scannedAt: string;
};

function parseStoredThread(value: unknown): CapturedThread | null {
  const parsed = capturedThreadSchema.safeParse(value);
  if (!parsed.success) {
    return null;
  }

  return parsed.data;
}

function threadRange(threadId: string): IDBKeyRange {
  return IDBKeyRange.bound([threadId, ''], [threadId, HIGHEST_KEY_CHARACTER]);
}

// Messages whose date never resolved. Their sort keys all begin with '~', which
// is what keeps them addressable instead of silently absent from the index.
function unresolvedRange(threadId: string): IDBKeyRange {
  return IDBKeyRange.bound(
    [threadId, UNRESOLVED_SORT_KEY_PREFIX],
    [threadId, `${UNRESOLVED_SORT_KEY_PREFIX}${HIGHEST_KEY_CHARACTER}`],
  );
}

// Walks an index with a cursor rather than reading the store and slicing it.
// advance() skips to the offset without deserialising what it passes, which is
// what makes paging a thread of 100 000 messages affordable.
function collectPage(
  index: IDBIndex,
  range: IDBKeyRange,
  offset: number,
  limit: number,
): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const values: unknown[] = [];
    const request = index.openCursor(range);
    let hasSkipped = offset === 0;

    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor === null) {
        resolve(values);
        return;
      }

      if (!hasSkipped) {
        hasSkipped = true;
        cursor.advance(offset);
        return;
      }

      values.push(cursor.value);
      if (values.length >= limit) {
        resolve(values);
        return;
      }

      cursor.continue();
    };

    request.onerror = () => {
      reject(request.error ?? new Error('Failed to read a message page'));
    };
  });
}

function parseMessages(values: unknown[]): CapturedMessage[] {
  return values.flatMap((value) => {
    const parsed = messengerDomain.itemSchema.safeParse(value);
    if (!parsed.success) {
      return [];
    }

    return [parsed.data];
  });
}

// A thread reached under a stronger id than the one it was stored under is the
// same conversation, so its messages move to the stronger key rather than being
// captured a second time under it.
async function findThreadByAnyAlias(
  threadStore: IDBObjectStore,
  aliases: readonly string[],
): Promise<CapturedThread | null> {
  for (const alias of aliases) {
    const atKey = parseStoredThread(await requestValue(threadStore.get(alias)));
    if (atKey !== null) {
      return atKey;
    }

    const byAlias = parseStoredThread(
      await requestValue(threadStore.index(ALIAS_INDEX).get(alias)),
    );
    if (byAlias !== null) {
      return byAlias;
    }
  }

  return null;
}

export const messageRepository = {
  isBetterParse: repository.isBetterParse,
  upsertMessages: repository.upsertItems,
  countMessages: repository.countItems,
  listAllMessages: repository.listAllItems,
  listCollectionStats: repository.listCollectionStats,
  clearMessages: repository.clearItems,
  clearThreadMessages: repository.clearCollectionItems,

  clearThreads: async (): Promise<void> => {
    await repository.write([THREAD_STORE_NAME], (stores) =>
      requestValue(stores.get(THREAD_STORE_NAME).clear()),
    );
  },

  listThreadMessagesPage: async (
    threadId: string,
    offset: number,
    limit: number,
  ): Promise<MessagePage> => {
    return repository.read([MESSAGE_STORE_NAME], async (stores) => {
      const index = stores.get(MESSAGE_STORE_NAME).index(THREAD_SORT_INDEX);
      const total = await requestValue(index.count(threadRange(threadId)));
      const values = await collectPage(index, threadRange(threadId), offset, limit);

      return { messages: parseMessages(values), total, offset, limit };
    });
  },

  countUnresolvedTimestamps: async (threadId: string): Promise<number> => {
    return repository.read([MESSAGE_STORE_NAME], (stores) =>
      requestValue(
        stores
          .get(MESSAGE_STORE_NAME)
          .index(THREAD_SORT_INDEX)
          .count(unresolvedRange(threadId)),
      ),
    );
  },

  listThreads: async (): Promise<CapturedThread[]> => {
    const values = await repository.read([THREAD_STORE_NAME], (stores) =>
      requestValue(stores.get(THREAD_STORE_NAME).getAll()),
    );

    return values.flatMap((value) => {
      const thread = parseStoredThread(value);
      if (thread === null) {
        return [];
      }

      return [thread];
    });
  },

  findThread: async (threadId: string): Promise<CapturedThread | null> => {
    return repository.read([THREAD_STORE_NAME], async (stores) =>
      findThreadByAnyAlias(stores.get(THREAD_STORE_NAME), [threadId]),
    );
  },

  // The id a thread's records are keyed under, which is the one it was first
  // captured under and not necessarily the one in the current URL. A message
  // with no id of its own is keyed by a hash that includes the thread id, so
  // letting that id change when the user arrives by a different handle would
  // re-import the thread. Resolving it once, before a scan starts, is what keeps
  // both surfaces and both id forms writing to the same records.
  resolveCanonicalThreadId: async (candidateIds: readonly string[]): Promise<string> => {
    const fallbackId = candidateIds[0];
    if (fallbackId === undefined) {
      throw new Error('A thread scan needs at least one candidate id');
    }

    return repository.read([THREAD_STORE_NAME], async (stores) => {
      const thread = await findThreadByAnyAlias(
        stores.get(THREAD_STORE_NAME),
        candidateIds,
      );

      return thread?.threadId ?? fallbackId;
    });
  },

  // Both stores are written in one transaction so a service worker dying
  // mid-batch cannot leave a thread's message count disagreeing with the store.
  // The count is reconciled from the index here rather than incremented, so it
  // cannot drift across scans.
  recordThreadScan: async (summary: ThreadScanSummary): Promise<CapturedThread> => {
    return repository.write([MESSAGE_STORE_NAME, THREAD_STORE_NAME], async (stores) => {
      const messageStore = stores.get(MESSAGE_STORE_NAME);
      const threadStore = stores.get(THREAD_STORE_NAME);
      const existingThread = await findThreadByAnyAlias(threadStore, [
        summary.threadId,
        ...summary.aliases,
      ]);

      const sortIndex = messageStore.index(THREAD_SORT_INDEX);
      const messageCount = await requestValue(
        sortIndex.count(threadRange(summary.threadId)),
      );
      const unresolvedTimestampCount = await requestValue(
        sortIndex.count(unresolvedRange(summary.threadId)),
      );
      const boundaries = await readThreadBoundaries(sortIndex, summary.threadId);

      const aliases = [
        ...new Set([
          ...(existingThread?.aliases ?? []),
          ...(existingThread === null ? [] : [existingThread.threadId]),
          ...summary.aliases,
          summary.threadId,
        ]),
      ];

      const thread: CapturedThread = {
        threadId: summary.threadId,
        threadIdSource: summary.threadIdSource,
        title: summary.title ?? existingThread?.title ?? null,
        aliases,
        isEncryptedThread: summary.isEncryptedThread,
        messageCount,
        unresolvedTimestampCount,
        // Once a thread has been read back to its first message, a later
        // partial scan must not downgrade that.
        reachedThreadStart:
          (existingThread?.reachedThreadStart ?? false) ||
          reachedThreadStart(summary.stopReason),
        lastStopReason: summary.stopReason,
        firstScannedAt: existingThread?.firstScannedAt ?? summary.scannedAt,
        lastScannedAt: summary.scannedAt,
        oldestSentAt: boundaries.oldestSentAt,
        newestSentAt: boundaries.newestSentAt,
      };

      await requestValue(threadStore.put(thread));
      return thread;
    });
  },

  // The keys a re-scan already holds. While every row in the viewport is one of
  // these, the scroller can move in long strides instead of dwelling.
  listThreadIdentityKeys: async (threadId: string): Promise<string[]> => {
    return repository.read([MESSAGE_STORE_NAME], async (stores) => {
      // An index's getAllKeys yields the primary keys of the matching records,
      // which for this store are the identity keys.
      const keys = await requestValue(
        stores
          .get(MESSAGE_STORE_NAME)
          .index(THREAD_SORT_INDEX)
          .getAllKeys(threadRange(threadId)),
      );

      return keys.filter((key): key is string => typeof key === 'string');
    });
  },
};

// Reads one end of an index range. A cursor is used rather than getAllKeys
// because an index's getAllKeys yields the primary keys of the matching records,
// not the index keys, and the sort key is what is wanted here.
function readEdgeSortKey(
  sortIndex: IDBIndex,
  range: IDBKeyRange,
  direction: IDBCursorDirection,
): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const request = sortIndex.openKeyCursor(range, direction);

    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor === null) {
        resolve(null);
        return;
      }

      const sortKey = Array.isArray(cursor.key) ? cursor.key[1] : null;
      resolve(typeof sortKey === 'string' ? sortKey : null);
    };

    request.onerror = () => {
      reject(request.error ?? new Error('Failed to read a thread boundary'));
    };
  });
}

// The first and last resolved instants in the thread. Unresolved messages sort
// after '~' and are excluded by the upper bound, so they cannot be mistaken for
// the newest message in the conversation.
async function readThreadBoundaries(
  sortIndex: IDBIndex,
  threadId: string,
): Promise<{ oldestSentAt: string | null; newestSentAt: string | null }> {
  const resolvedRange = IDBKeyRange.bound(
    [threadId, ''],
    [threadId, UNRESOLVED_SORT_KEY_PREFIX],
    false,
    true,
  );

  return {
    oldestSentAt: await readEdgeSortKey(sortIndex, resolvedRange, 'next'),
    newestSentAt: await readEdgeSortKey(sortIndex, resolvedRange, 'prev'),
  };
}
