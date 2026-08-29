import { beforeEach, describe, expect, it } from 'vitest';
import type { CapturedMessage } from '../types/capturedMessage';
import { buildSortKey } from '../types/capturedMessage';
import { messageRepository } from './messageRepository';

const THREAD_ID = '61550123456789';
const VANITY_ID = 'alice.dupont';

function createMessage(
  index: number,
  overrides: Partial<CapturedMessage> = {},
): CapturedMessage {
  const sentAt = new Date(Date.UTC(2026, 7, 19, 12, index)).toISOString();
  const capturedAt = new Date(Date.UTC(2026, 7, 29, 9, index)).toISOString();
  const threadId = overrides.threadId ?? THREAD_ID;

  return {
    identityKey: `msg:mid.$message${String(index)}`,
    identitySource: 'externalId',
    fingerprint: null,
    externalId: `mid.$message${String(index)}`,
    externalUrl: null,
    collection: { name: 'Alex Moreau', url: `https://www.messenger.com/t/${threadId}` },
    threadId,
    messageId: `mid.$message${String(index)}`,
    sender: { kind: 'other', name: 'Alex Moreau' },
    displayedAt: '16:15',
    sentAt,
    sortKey: buildSortKey(sentAt, capturedAt),
    text: `Message ${String(index)}`,
    isReply: false,
    isUnsent: false,
    reactions: [],
    attachments: [{ kind: 'none' }],
    warnings: [],
    capturedAt,
    updatedAt: capturedAt,
    ...overrides,
  };
}

function createUnresolvedMessage(index: number): CapturedMessage {
  const capturedAt = new Date(Date.UTC(2026, 7, 29, 9, index)).toISOString();

  return createMessage(index, {
    identityKey: `msg:mid.$unresolved${String(index)}`,
    externalId: `mid.$unresolved${String(index)}`,
    messageId: `mid.$unresolved${String(index)}`,
    displayedAt: null,
    sentAt: null,
    sortKey: buildSortKey(null, capturedAt),
    warnings: ['UNRESOLVED_TIMESTAMP'],
  });
}

beforeEach(async () => {
  await messageRepository.clearMessages();
  await messageRepository.clearThreads();
});

describe('messageRepository', () => {
  it('stores a batch of messages', async () => {
    const inserted = await messageRepository.upsertMessages([
      createMessage(1),
      createMessage(2),
      createMessage(3),
    ]);

    expect(inserted).toBe(3);
    expect(await messageRepository.countMessages()).toBe(3);
  });

  // The whole point of the identity design: running a scan twice must not
  // produce a second copy of the conversation.
  it('inserts nothing when the same batch is stored again', async () => {
    const batch = [createMessage(1), createMessage(2), createMessage(3)];
    await messageRepository.upsertMessages(batch);

    const reinserted = await messageRepository.upsertMessages(batch);

    expect(reinserted).toBe(0);
    expect(await messageRepository.countMessages()).toBe(3);
  });

  it('keeps the first capture time and advances the update time on a re-scan', async () => {
    const first = createMessage(1);
    await messageRepository.upsertMessages([first]);

    await messageRepository.upsertMessages([
      { ...first, text: 'Message 1 with more of it revealed', updatedAt: '2026-09-01T10:00:00.000Z' },
    ]);

    const [stored] = await messageRepository.listAllMessages();
    expect(stored?.capturedAt).toBe(first.capturedAt);
    expect(stored?.updatedAt).toBe('2026-09-01T10:00:00.000Z');
    expect(stored?.text).toBe('Message 1 with more of it revealed');
  });

  it('resolves a date for a message stored without one', async () => {
    const unresolved = createUnresolvedMessage(1);
    await messageRepository.upsertMessages([unresolved]);

    const resolvedAt = '2026-08-19T12:01:00.000Z';
    await messageRepository.upsertMessages([
      {
        ...unresolved,
        sentAt: resolvedAt,
        sortKey: resolvedAt,
        displayedAt: 'Tuesday 14:01',
        warnings: [],
      },
    ]);

    const [stored] = await messageRepository.listAllMessages();
    expect(stored?.sentAt).toBe(resolvedAt);
    expect(await messageRepository.countMessages()).toBe(1);
  });

  it('does not lose the captured text when a message is unsent afterwards', async () => {
    const message = createMessage(1);
    await messageRepository.upsertMessages([message]);

    await messageRepository.upsertMessages([
      { ...message, text: null, isUnsent: true },
    ]);

    const [stored] = await messageRepository.listAllMessages();
    expect(stored?.text).toBe('Message 1');
    expect(stored?.isUnsent).toBe(true);
    expect(stored?.warnings).toContain('UNSENT_AFTER_CAPTURE');
  });
});

describe('messageRepository paging', () => {
  it('pages a thread in date order', async () => {
    await messageRepository.upsertMessages([
      createMessage(3),
      createMessage(1),
      createMessage(2),
    ]);

    const firstPage = await messageRepository.listThreadMessagesPage(THREAD_ID, 0, 2);
    const secondPage = await messageRepository.listThreadMessagesPage(THREAD_ID, 2, 2);

    expect(firstPage.total).toBe(3);
    expect(firstPage.messages.map((message) => message.text)).toEqual([
      'Message 1',
      'Message 2',
    ]);
    expect(secondPage.messages.map((message) => message.text)).toEqual(['Message 3']);
  });

  it('pages only the thread asked for', async () => {
    await messageRepository.upsertMessages([
      createMessage(1),
      createMessage(2, {
        threadId: 'other-thread',
        identityKey: 'msg:mid.$other',
        externalId: 'mid.$other',
        messageId: 'mid.$other',
      }),
    ]);

    const page = await messageRepository.listThreadMessagesPage(THREAD_ID, 0, 10);

    expect(page.total).toBe(1);
    expect(page.messages[0]?.threadId).toBe(THREAD_ID);
  });

  // Indexing on sentAt directly would drop these records from the index
  // entirely, which is why sortKey exists.
  it('keeps messages with no resolved date enumerable and last', async () => {
    await messageRepository.upsertMessages([
      createMessage(1),
      createUnresolvedMessage(2),
      createUnresolvedMessage(3),
    ]);

    const page = await messageRepository.listThreadMessagesPage(THREAD_ID, 0, 10);

    expect(page.total).toBe(3);
    expect(page.messages.at(0)?.sentAt).not.toBeNull();
    expect(page.messages.at(-1)?.sentAt).toBeNull();
    expect(await messageRepository.countUnresolvedTimestamps(THREAD_ID)).toBe(2);
  });
});

describe('messageRepository thread records', () => {
  it('reconciles the message count from the store', async () => {
    await messageRepository.upsertMessages([createMessage(1), createMessage(2)]);

    const thread = await messageRepository.recordThreadScan({
      threadId: THREAD_ID,
      threadIdSource: 'numeric',
      aliases: [],
      title: 'Alex Moreau',
      isEncryptedThread: false,
      stopReason: 'reachedStart',
      scannedAt: '2026-08-29T09:30:00.000Z',
    });

    expect(thread.messageCount).toBe(2);
    expect(thread.reachedThreadStart).toBe(true);
    expect(thread.oldestSentAt).toBe('2026-08-19T12:01:00.000Z');
    expect(thread.newestSentAt).toBe('2026-08-19T12:02:00.000Z');
  });

  it('reports a blocked scan as its own outcome rather than a success', async () => {
    const thread = await messageRepository.recordThreadScan({
      threadId: THREAD_ID,
      threadIdSource: 'numeric',
      aliases: [],
      title: null,
      isEncryptedThread: false,
      stopReason: 'blocked',
      scannedAt: '2026-08-29T09:30:00.000Z',
    });

    expect(thread.lastStopReason).toBe('blocked');
    expect(thread.reachedThreadStart).toBe(false);
  });

  it('does not let a later partial scan withdraw a completed one', async () => {
    const base = {
      threadId: THREAD_ID,
      threadIdSource: 'numeric' as const,
      aliases: [],
      title: null,
      isEncryptedThread: false,
    };

    await messageRepository.recordThreadScan({
      ...base,
      stopReason: 'reachedStart',
      scannedAt: '2026-08-29T09:00:00.000Z',
    });
    const second = await messageRepository.recordThreadScan({
      ...base,
      stopReason: 'stepCap',
      scannedAt: '2026-08-30T09:00:00.000Z',
    });

    expect(second.reachedThreadStart).toBe(true);
    expect(second.lastStopReason).toBe('stepCap');
    expect(second.firstScannedAt).toBe('2026-08-29T09:00:00.000Z');
    expect(second.lastScannedAt).toBe('2026-08-30T09:00:00.000Z');
  });

  it('recognises a thread reached under a second id', async () => {
    await messageRepository.recordThreadScan({
      threadId: VANITY_ID,
      threadIdSource: 'vanity',
      aliases: [],
      title: 'Alex Moreau',
      isEncryptedThread: false,
      stopReason: 'reachedStart',
      scannedAt: '2026-08-29T09:00:00.000Z',
    });

    const thread = await messageRepository.recordThreadScan({
      threadId: VANITY_ID,
      threadIdSource: 'vanity',
      aliases: [THREAD_ID],
      title: 'Alex Moreau',
      isEncryptedThread: false,
      stopReason: 'reachedStart',
      scannedAt: '2026-08-30T09:00:00.000Z',
    });

    expect(thread.aliases).toContain(THREAD_ID);
    expect(thread.aliases).toContain(VANITY_ID);
    expect(await messageRepository.listThreads()).toHaveLength(1);
  });

  // A thread reached by a different handle must keep writing to the records it
  // already has, because a content-hash key embeds the thread id.
  it('keeps the id a thread was first captured under', async () => {
    await messageRepository.recordThreadScan({
      threadId: VANITY_ID,
      threadIdSource: 'vanity',
      aliases: [THREAD_ID],
      title: null,
      isEncryptedThread: false,
      stopReason: 'reachedStart',
      scannedAt: '2026-08-29T09:00:00.000Z',
    });

    const canonicalFromNumeric = await messageRepository.resolveCanonicalThreadId([
      THREAD_ID,
    ]);
    const canonicalFromVanity = await messageRepository.resolveCanonicalThreadId([
      VANITY_ID,
    ]);

    expect(canonicalFromNumeric).toBe(VANITY_ID);
    expect(canonicalFromVanity).toBe(VANITY_ID);
  });

  it('falls back to the current id for a thread never captured before', async () => {
    expect(await messageRepository.resolveCanonicalThreadId([THREAD_ID])).toBe(THREAD_ID);
  });

  it('lists the keys a re-scan already holds', async () => {
    await messageRepository.upsertMessages([createMessage(1), createMessage(2)]);

    const keys = await messageRepository.listThreadIdentityKeys(THREAD_ID);

    expect(new Set(keys)).toEqual(
      new Set(['msg:mid.$message1', 'msg:mid.$message2']),
    );
  });
});
