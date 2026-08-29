import { describe, expect, it } from 'vitest';
import type { ParsedMessage } from '../types/message';
import { DuplicateMessageIndex, resolveMessageIdentity } from './messageIdentity';

const THREAD_ID = '61550123456789';

function parsedMessage(overrides: Partial<ParsedMessage> = {}): ParsedMessage {
  return {
    messageId: null,
    sender: { kind: 'other', name: 'Alex Moreau' },
    displayedAt: '16:15',
    sentAt: '2026-08-29T14:15:00.000Z',
    text: 'ok',
    isReply: false,
    reactions: [],
    attachments: [{ kind: 'none' }],
    warnings: [],
    ...overrides,
  };
}

// Resolves a run of messages the way a scan does: one duplicate index per
// message, drawn from a counter shared across the whole scan.
async function resolveRun(messages: ParsedMessage[]): Promise<string[]> {
  const duplicateIndex = new DuplicateMessageIndex(50_000);
  const keys: string[] = [];

  for (const message of messages) {
    const index = duplicateIndex.next(THREAD_ID, message);
    const identity = await resolveMessageIdentity(THREAD_ID, message, index ?? 0);
    keys.push(identity.identityKey);
  }

  return keys;
}

describe('resolveMessageIdentity', () => {
  it('keys a message by the id Messenger put on the row', async () => {
    const identity = await resolveMessageIdentity(
      THREAD_ID,
      parsedMessage({ messageId: 'mid.$abcdefghijkl' }),
      0,
    );

    expect(identity.identityKey).toBe('msg:mid.$abcdefghijkl');
    expect(identity.identitySource).toBe('externalId');
    expect(identity.externalId).toBe('mid.$abcdefghijkl');
  });

  it('falls back to a content hash when the row carried no usable id', async () => {
    const identity = await resolveMessageIdentity(THREAD_ID, parsedMessage(), 0);

    expect(identity.identitySource).toBe('contentHash');
    expect(identity.identityKey).toMatch(/^msgHash:[0-9a-f]{64}$/);
  });

  // The failure this whole scheme exists to prevent: three identical short
  // messages collapsing into one record.
  it('gives three identical "ok" messages three distinct keys', async () => {
    const keys = await resolveRun([parsedMessage(), parsedMessage(), parsedMessage()]);

    expect(new Set(keys).size).toBe(3);
  });

  it('resolves the same three keys when the thread is scanned again', async () => {
    const firstScan = await resolveRun([
      parsedMessage(),
      parsedMessage(),
      parsedMessage(),
    ]);
    const secondScan = await resolveRun([
      parsedMessage(),
      parsedMessage(),
      parsedMessage(),
    ]);

    expect(secondScan).toEqual(firstScan);
  });

  // The reason the timestamp is kept out of the key: Messenger rewrites the
  // displayed value as days pass, and a message parsed before its date separator
  // is in view has no date at all.
  it('keys a message the same way before and after its date is resolved', async () => {
    const unanchored = await resolveMessageIdentity(
      THREAD_ID,
      parsedMessage({ displayedAt: null, sentAt: null }),
      0,
    );
    const anchored = await resolveMessageIdentity(
      THREAD_ID,
      parsedMessage({ displayedAt: 'Tuesday 16:15', sentAt: '2026-08-25T14:15:00.000Z' }),
      0,
    );

    expect(anchored.identityKey).toBe(unanchored.identityKey);
  });

  it('separates the same text sent by two different people', async () => {
    const fromAlex = await resolveMessageIdentity(THREAD_ID, parsedMessage(), 0);
    const fromReader = await resolveMessageIdentity(
      THREAD_ID,
      parsedMessage({ sender: { kind: 'self' } }),
      0,
    );

    expect(fromReader.identityKey).not.toBe(fromAlex.identityKey);
  });

  it('separates the same text sent in two different threads', async () => {
    const inThread = await resolveMessageIdentity(THREAD_ID, parsedMessage(), 0);
    const inOtherThread = await resolveMessageIdentity('99887766554433', parsedMessage(), 0);

    expect(inOtherThread.identityKey).not.toBe(inThread.identityKey);
  });
});

describe('DuplicateMessageIndex', () => {
  it('counts each bucket separately', () => {
    const index = new DuplicateMessageIndex(50_000);
    const fromAlex = parsedMessage();
    const fromReader = parsedMessage({ sender: { kind: 'self' } });

    expect(index.next(THREAD_ID, fromAlex)).toBe(0);
    expect(index.next(THREAD_ID, fromReader)).toBe(0);
    expect(index.next(THREAD_ID, fromAlex)).toBe(1);
    expect(index.next(THREAD_ID, fromAlex)).toBe(2);
  });

  // A deletion between two scans shifts only later copies of the very same text
  // from the very same sender. Everything else in the thread keeps its key.
  it('re-keys nothing outside the bucket a deleted message belonged to', async () => {
    const before = await resolveRun([
      parsedMessage({ text: 'see you tomorrow' }),
      parsedMessage(),
      parsedMessage(),
      parsedMessage({ text: 'thanks' }),
    ]);
    const after = await resolveRun([
      parsedMessage({ text: 'see you tomorrow' }),
      parsedMessage(),
      parsedMessage({ text: 'thanks' }),
    ]);

    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    expect(after[2]).toBe(before[3]);
  });

  it('reports an overflow instead of growing without bound', () => {
    const index = new DuplicateMessageIndex(2);

    expect(index.next(THREAD_ID, parsedMessage({ text: 'one' }))).toBe(0);
    expect(index.next(THREAD_ID, parsedMessage({ text: 'two' }))).toBe(0);
    expect(index.hasOverflowed).toBe(false);

    expect(index.next(THREAD_ID, parsedMessage({ text: 'three' }))).toBeNull();
    expect(index.hasOverflowed).toBe(true);
  });

  it('keeps counting a bucket it already knows after the cap is reached', () => {
    const index = new DuplicateMessageIndex(1);
    const message = parsedMessage();

    expect(index.next(THREAD_ID, message)).toBe(0);
    expect(index.next(THREAD_ID, parsedMessage({ text: 'other' }))).toBeNull();
    expect(index.next(THREAD_ID, message)).toBe(1);
  });
});
