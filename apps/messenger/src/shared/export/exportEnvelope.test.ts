import { describe, expect, it } from 'vitest';
import type { CapturedMessage } from '../types/capturedMessage';
import { buildSortKey } from '../types/capturedMessage';
import type { CapturedThread } from '../types/thread';
import {
  buildThreadExport,
  buildThreadExportEnvelope,
  EXPORT_SCHEMA_VERSION,
} from './exportEnvelope';

const THREAD_ID = '61550123456789';
const EXPORTED_AT = '2026-08-29T09:00:00.000Z';

function createThread(overrides: Partial<CapturedThread> = {}): CapturedThread {
  return {
    threadId: THREAD_ID,
    threadIdSource: 'numeric',
    title: 'Alex Moreau',
    aliases: [THREAD_ID],
    isEncryptedThread: false,
    messageCount: 2,
    unresolvedTimestampCount: 0,
    reachedThreadStart: true,
    lastStopReason: 'reachedStart',
    firstScannedAt: '2026-08-29T08:00:00.000Z',
    lastScannedAt: EXPORTED_AT,
    oldestSentAt: '2026-07-15T17:38:00.000Z',
    newestSentAt: '2026-08-19T12:00:00.000Z',
    ...overrides,
  };
}

function createMessage(
  index: number,
  overrides: Partial<CapturedMessage> = {},
): CapturedMessage {
  const sentAt = new Date(Date.UTC(2026, 7, 19, 12, index)).toISOString();
  const capturedAt = new Date(Date.UTC(2026, 7, 29, 9, index)).toISOString();

  return {
    identityKey: `msg:mid.$message${String(index)}`,
    identitySource: 'externalId',
    fingerprint: null,
    externalId: `mid.$message${String(index)}`,
    externalUrl: null,
    collection: {
      name: 'Alex Moreau',
      url: `https://www.messenger.com/t/${THREAD_ID}`,
    },
    threadId: THREAD_ID,
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
    displayedAt: null,
    sentAt: null,
    sortKey: buildSortKey(null, capturedAt),
    warnings: ['UNRESOLVED_TIMESTAMP'],
  });
}

describe('buildThreadExportEnvelope', () => {
  it('builds a versioned envelope ordered by sort key', () => {
    const envelope = buildThreadExportEnvelope(
      createThread(),
      [createMessage(2), createMessage(1)],
      '0.1.0',
      EXPORTED_AT,
    );

    expect(envelope.schemaVersion).toBe(EXPORT_SCHEMA_VERSION);
    expect(envelope.extensionVersion).toBe('0.1.0');
    expect(envelope.exportedAt).toBe(EXPORTED_AT);
    expect(envelope.messages.map((message) => message.text)).toEqual([
      'Message 1',
      'Message 2',
    ]);
  });

  it('counts reactions, attachments and incomplete messages', () => {
    const envelope = buildThreadExportEnvelope(
      createThread(),
      [
        createMessage(1, {
          reactions: [
            { emoji: '❤️', count: 2 },
            { emoji: '😂', count: 1 },
          ],
          attachments: [{ kind: 'file', caption: 'report.pdf' }],
        }),
        createMessage(2, { warnings: ['MISSING_SENDER'] }),
      ],
      '0.1.0',
      EXPORTED_AT,
    );

    // Every stat counts records present in the file, so a reader can recount it
    // from `messages`. A reaction pill says three people reacted; the file holds
    // two reactions, and reporting three would not be checkable against it.
    expect(envelope.stats).toEqual({
      messageCount: 2,
      incompleteMessageCount: 1,
      unresolvedTimestampCount: 0,
      reactionCount: 2,
      attachmentCount: 1,
    });
  });

  // An absent attachment is modelled as `{ kind: 'none' }` so that a merge has
  // something to carry; counting it would report attachments nobody sent.
  it('does not count the absence of an attachment as one', () => {
    const envelope = buildThreadExportEnvelope(
      createThread(),
      [createMessage(1)],
      '0.1.0',
      EXPORTED_AT,
    );

    expect(envelope.stats.attachmentCount).toBe(0);
  });

  // An unresolved message sorts to the end of the thread, and letting it stand
  // in for the newest one would report a window the conversation never had.
  it('bounds the conversation window with resolved dates only', () => {
    const envelope = buildThreadExportEnvelope(
      createThread(),
      [createMessage(1), createMessage(2), createUnresolvedMessage(3)],
      '0.1.0',
      EXPORTED_AT,
    );

    expect(envelope.conversationWindow).toEqual({
      earliest: '2026-08-19T12:01:00.000Z',
      latest: '2026-08-19T12:02:00.000Z',
    });
    expect(envelope.stats.unresolvedTimestampCount).toBe(1);
  });
});

describe('export warnings', () => {
  it('reports nothing when a complete thread carries no flagged message', () => {
    const envelope = buildThreadExportEnvelope(
      createThread(),
      [createMessage(1)],
      '0.1.0',
      EXPORTED_AT,
    );

    expect(envelope.warnings).toEqual([]);
  });

  // The flag that decides whether a partial history can be mistaken for a whole
  // one, which is the single most misleading thing an export could do.
  it('flags a history that stopped before the first message', () => {
    const envelope = buildThreadExportEnvelope(
      createThread({ reachedThreadStart: false, lastStopReason: 'blocked' }),
      [createMessage(1)],
      '0.1.0',
      EXPORTED_AT,
    );

    expect(envelope.warnings).toContain('INCOMPLETE_HISTORY');
  });

  it('flags an encrypted conversation whose content is in the file', () => {
    const envelope = buildThreadExportEnvelope(
      createThread({ isEncryptedThread: true }),
      [createMessage(1)],
      '0.1.0',
      EXPORTED_AT,
    );

    expect(envelope.warnings).toContain('ENCRYPTED_THREAD');
  });

  it('flags unresolved, inferred and unstable messages from the records', () => {
    const envelope = buildThreadExportEnvelope(
      createThread(),
      [
        createUnresolvedMessage(1),
        createMessage(2, { warnings: ['INFERRED_TIMESTAMP'] }),
        createMessage(3, {
          identitySource: 'contentHash',
          warnings: ['UNSTABLE_IDENTITY'],
        }),
      ],
      '0.1.0',
      EXPORTED_AT,
    );

    expect(envelope.warnings).toEqual([
      'UNRESOLVED_TIMESTAMPS',
      'INFERRED_TIMESTAMPS',
      'UNSTABLE_IDENTITIES',
    ]);
  });
});

describe('buildThreadExport', () => {
  it('names the file after the title and the window of its messages', () => {
    const { fileName } = buildThreadExport(
      createThread(),
      [
        createMessage(1, { sentAt: '2026-07-15T17:38:00.000Z' }),
        createMessage(2, { sentAt: '2026-08-19T12:00:00.000Z' }),
      ],
      '0.1.0',
      EXPORTED_AT,
    );

    expect(fileName).toBe('alex-moreau_2026-07-15_2026-08-19.json');
  });

  it('falls back to the export day when no message has a resolved date', () => {
    const { fileName } = buildThreadExport(
      createThread(),
      [createUnresolvedMessage(1)],
      '0.1.0',
      EXPORTED_AT,
    );

    expect(fileName).toBe('alex-moreau_export-2026-08-29.json');
  });

  it('strips accents and punctuation from a title', () => {
    const { fileName } = buildThreadExport(
      createThread({ title: 'Équipe Été — Café !' }),
      [createMessage(1, { sentAt: '2026-08-19T12:00:00.000Z' })],
      '0.1.0',
      EXPORTED_AT,
    );

    expect(fileName).toBe('equipe-ete-cafe_2026-08-19_2026-08-19.json');
  });

  // A group can be named entirely in a script the slug drops, and an untitled
  // thread has no name at all; neither may produce a file called `.json`.
  it('names the file after the thread id when the title has no slug', () => {
    const { fileName } = buildThreadExport(
      createThread({ title: '???' }),
      [createMessage(1, { sentAt: '2026-08-19T12:00:00.000Z' })],
      '0.1.0',
      EXPORTED_AT,
    );

    expect(fileName).toBe(`${THREAD_ID}_2026-08-19_2026-08-19.json`);
  });
});
