import { describe, expect, it } from 'vitest';
import {
  isBetterCapturedMessage,
  isIdentifiableCapturedMessage,
  mergeAttachments,
  mergeCapturedMessage,
  mergeReactions,
} from './captureQuality';
import type { CapturedMessage } from './types/capturedMessage';
import { buildSortKey } from './types/capturedMessage';

const THREAD_ID = '61550123456789';
const SENT_AT = '2026-08-19T12:00:00.000Z';
const CAPTURED_AT = '2026-08-29T09:00:00.000Z';

function createMessage(overrides: Partial<CapturedMessage> = {}): CapturedMessage {
  return {
    identityKey: 'msg:mid.$message1',
    identitySource: 'externalId',
    fingerprint: null,
    externalId: 'mid.$message1',
    externalUrl: null,
    collection: {
      name: 'Alex Moreau',
      url: `https://www.messenger.com/t/${THREAD_ID}`,
    },
    threadId: THREAD_ID,
    messageId: 'mid.$message1',
    sender: { kind: 'other', name: 'Alex Moreau' },
    displayedAt: '16:15',
    sentAt: SENT_AT,
    sortKey: buildSortKey(SENT_AT, CAPTURED_AT),
    text: 'Hello',
    isReply: false,
    isUnsent: false,
    reactions: [],
    attachments: [{ kind: 'none' }],
    warnings: [],
    capturedAt: CAPTURED_AT,
    updatedAt: CAPTURED_AT,
    ...overrides,
  };
}

describe('mergeReactions', () => {
  it('keeps the highest count seen per emoji', () => {
    const merged = mergeReactions(
      [{ emoji: '❤️', count: 1 }],
      [{ emoji: '❤️', count: 3 }],
    );

    expect(merged).toEqual([{ emoji: '❤️', count: 3 }]);
  });

  // A sighting taken as the viewport moved on can carry fewer reactions than an
  // earlier one, and letting it win would drop reactions already captured.
  it('does not let a later, poorer sighting lower a count', () => {
    const merged = mergeReactions(
      [{ emoji: '❤️', count: 4 }],
      [{ emoji: '❤️', count: 1 }],
    );

    expect(merged).toEqual([{ emoji: '❤️', count: 4 }]);
  });

  it('keeps emojis from both sightings', () => {
    const merged = mergeReactions(
      [{ emoji: '❤️', count: 1 }],
      [{ emoji: '😂', count: 2 }],
    );

    expect(merged).toHaveLength(2);
  });
});

describe('mergeAttachments', () => {
  it('drops the absence marker once a real attachment is seen', () => {
    const merged = mergeAttachments(
      [{ kind: 'none' }],
      [{ kind: 'file', caption: 'report.pdf' }],
    );

    expect(merged).toEqual([{ kind: 'file', caption: 'report.pdf' }]);
  });

  it('keeps the absence marker when neither sighting saw an attachment', () => {
    expect(mergeAttachments([{ kind: 'none' }], [{ kind: 'none' }])).toEqual([
      { kind: 'none' },
    ]);
  });

  it('stores one entry per distinct attachment', () => {
    const merged = mergeAttachments(
      [{ kind: 'file', caption: 'report.pdf' }],
      [{ kind: 'file', caption: 'report.pdf' }, { kind: 'story' }],
    );

    expect(merged).toHaveLength(2);
  });
});

describe('isBetterCapturedMessage', () => {
  // The reason the date-anchoring pass is worth running: a message first read
  // above its own separator becomes datable a step or two later.
  it('prefers a sighting that resolved a date', () => {
    const existing = createMessage({
      sentAt: null,
      sortKey: buildSortKey(null, CAPTURED_AT),
    });

    expect(isBetterCapturedMessage(existing, createMessage())).toBe(true);
  });

  it('prefers a sighting that carries an id', () => {
    const existing = createMessage({ messageId: null });

    expect(isBetterCapturedMessage(existing, createMessage())).toBe(true);
  });

  it('prefers a sighting with fewer warnings', () => {
    const existing = createMessage({ warnings: ['MISSING_SENDER'] });

    expect(isBetterCapturedMessage(existing, createMessage())).toBe(true);
  });

  it('prefers a sighting with more text', () => {
    const incoming = createMessage({ text: 'Hello, at length' });

    expect(isBetterCapturedMessage(createMessage(), incoming)).toBe(true);
  });

  it('prefers a sighting that named the sender', () => {
    const existing = createMessage({ sender: null });

    expect(isBetterCapturedMessage(existing, createMessage())).toBe(true);
  });

  it('treats an identical sighting as no improvement', () => {
    expect(isBetterCapturedMessage(createMessage(), createMessage())).toBe(false);
  });

  // A message unsent between two scans arrives empty. Shorter text must not
  // count as an improvement, or the unsend would erase what was captured.
  it('does not treat less text as an improvement', () => {
    const existing = createMessage({ text: 'Hello, at length' });

    expect(isBetterCapturedMessage(existing, createMessage({ text: null }))).toBe(false);
  });

  it('treats an unsend as news despite carrying less', () => {
    const incoming = createMessage({ text: null, isUnsent: true });

    expect(isBetterCapturedMessage(createMessage(), incoming)).toBe(true);
  });
});

describe('mergeCapturedMessage', () => {
  it('keeps the resolved date and its sort key when a later sighting has none', () => {
    const existing = createMessage();
    const incoming = createMessage({
      sentAt: null,
      sortKey: buildSortKey(null, CAPTURED_AT),
    });

    const merged = mergeCapturedMessage(existing, incoming);

    expect(merged.sentAt).toBe(SENT_AT);
    expect(merged.sortKey).toBe(existing.sortKey);
  });

  it('takes the date of a later sighting that resolved one', () => {
    const existing = createMessage({
      sentAt: null,
      sortKey: buildSortKey(null, CAPTURED_AT),
    });

    const merged = mergeCapturedMessage(existing, createMessage());

    expect(merged.sentAt).toBe(SENT_AT);
    expect(merged.sortKey).toBe(SENT_AT);
  });

  // What was captured before an unsend is the only record that the message ever
  // existed, so the text is kept and the unsend is recorded as a flag.
  it('keeps the text of an unsent message and flags the unsend', () => {
    const merged = mergeCapturedMessage(
      createMessage(),
      createMessage({ text: null, isUnsent: true }),
    );

    expect(merged.text).toBe('Hello');
    expect(merged.isUnsent).toBe(true);
    expect(merged.warnings).toContain('UNSENT_AFTER_CAPTURE');
  });

  it('keeps an unsend recorded by an earlier sighting', () => {
    const merged = mergeCapturedMessage(
      createMessage({ isUnsent: true, warnings: ['UNSENT_AFTER_CAPTURE'] }),
      createMessage(),
    );

    expect(merged.isUnsent).toBe(true);
    expect(merged.warnings).toEqual(['UNSENT_AFTER_CAPTURE']);
  });

  it('keeps the id and sender an earlier sighting resolved', () => {
    const merged = mergeCapturedMessage(
      createMessage(),
      createMessage({ messageId: null, sender: null }),
    );

    expect(merged.messageId).toBe('mid.$message1');
    expect(merged.sender).toEqual({ kind: 'other', name: 'Alex Moreau' });
  });
});

describe('isIdentifiableCapturedMessage', () => {
  it('accepts any message keyed by its own id', () => {
    expect(isIdentifiableCapturedMessage(createMessage())).toBe(true);
  });

  it('accepts a hashed message that names a sender', () => {
    const hashed = createMessage({ identitySource: 'contentHash', messageId: null });

    expect(isIdentifiableCapturedMessage(hashed)).toBe(true);
  });

  it('accepts a hashed message that carries text but no sender', () => {
    const hashed = createMessage({
      identitySource: 'contentHash',
      messageId: null,
      sender: null,
      text: 'Hello',
    });

    expect(isIdentifiableCapturedMessage(hashed)).toBe(true);
  });

  // Storing a blank hashed message would let one overwrite another under the
  // same hash, so it is rejected rather than stored.
  it('rejects a hashed message with neither sender nor text', () => {
    const blank = createMessage({
      identitySource: 'contentHash',
      messageId: null,
      sender: null,
      text: '   ',
    });

    expect(isIdentifiableCapturedMessage(blank)).toBe(false);
  });
});
