import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findMessageElements, parseMessage } from './parseMessage';

const fixturesDirectory = join(import.meta.dirname, '__fixtures__');

// Saved from real conversations, then anonymized by scripts/build-fixtures.mjs.
// Names and message bodies are synthetic; identifiers, timestamps, roles and
// nesting are untouched, which is the only reason these are worth testing on.
const FIXTURES = [
  'thread-same-day.html',
  'thread-weekday-dates.html',
  'thread-absolute-dates.html',
  'thread-reactions.html',
] as const;

// A Friday, so that the weekday fixture resolves to the Tuesday three days back
// rather than wrapping to the previous week.
const REFERENCE_DATE = new Date(2026, 7, 28, 23, 30);

function loadThread(name: string): ParentNode {
  document.body.innerHTML = readFileSync(join(fixturesDirectory, name), 'utf8');
  const log = document.body.querySelector('div[role="log"]');

  if (log === null) {
    throw new Error(`Thread fixture "${name}" has no message log`);
  }

  return log;
}

describe('parseMessage', () => {
  it.each(FIXTURES)('reads every message in %s', (fixture) => {
    const messages = findMessageElements(loadThread(fixture)).map((element) =>
      parseMessage(element, REFERENCE_DATE),
    );

    expect(messages.length).toBeGreaterThan(0);

    for (const message of messages) {
      expect(message.messageId).not.toBeNull();
      expect(message.sender).not.toBeNull();
      expect(message.sentAt).not.toBeNull();
      expect(message.warnings).not.toContain('REJECTED_MESSAGE_ID');
      expect(message.warnings).not.toContain('UNPARSED_TIMESTAMP');
    }
  });

  it.each(FIXTURES)('gives every message in %s a distinct id', (fixture) => {
    const messages = findMessageElements(loadThread(fixture)).map((element) =>
      parseMessage(element, REFERENCE_DATE),
    );
    const ids = new Set(messages.map((message) => message.messageId));

    expect(ids.size).toBe(messages.length);
  });

  it('reads the sender, timestamp and text of a message', () => {
    const messages = findMessageElements(loadThread('thread-reactions.html')).map(
      (element) => parseMessage(element, REFERENCE_DATE),
    );
    const first = messages[0];

    expect(first?.sender).toEqual({ kind: 'other', name: 'Bea Lambert' });
    expect(first?.displayedAt).toBe('16:15');
    expect(first?.text).toBe(
      'qu anima an temp fer lu nect sil rat unda ce mir qu orb quibu an fer lu te feru unda lu nec si rati orb und ferunt lucem cert te ratio unda certus',
    );
  });

  it('tells an outgoing message from an incoming one', () => {
    const messages = findMessageElements(loadThread('thread-reactions.html')).map(
      (element) => parseMessage(element, REFERENCE_DATE),
    );

    expect(messages.filter((message) => message.sender?.kind === 'self')).not.toHaveLength(
      0,
    );
    expect(
      messages.filter((message) => message.sender?.kind === 'other'),
    ).not.toHaveLength(0);
  });

  it('reads a reaction and the message it is attached to', () => {
    const messages = findMessageElements(loadThread('thread-reactions.html')).map(
      (element) => parseMessage(element, REFERENCE_DATE),
    );
    const reacted = messages.filter((message) => message.reactions.length > 0);

    expect(reacted.length).toBeGreaterThan(0);
    for (const message of reacted) {
      expect(message.reactions[0]?.count).toBe(1);
      expect(message.reactions[0]?.emoji).not.toBe('');
    }
  });

  it('flags a message that replies to another', () => {
    const messages = findMessageElements(loadThread('thread-same-day.html')).map(
      (element) => parseMessage(element, REFERENCE_DATE),
    );

    expect(messages.filter((message) => message.isReply).length).toBeGreaterThan(0);
  });

  it('reads a message whose only content is an attachment', () => {
    const messages = findMessageElements(loadThread('thread-weekday-dates.html')).map(
      (element) => parseMessage(element, REFERENCE_DATE),
    );
    const bodyless = messages.filter((message) => message.text === null);

    expect(bodyless.length).toBeGreaterThan(0);
    for (const message of bodyless) {
      expect(message.warnings).toContain('MISSING_TEXT');
      expect(message.sender).not.toBeNull();
    }
  });

  it('reads a shared story as an attachment', () => {
    const messages = findMessageElements(loadThread('thread-weekday-dates.html')).map(
      (element) => parseMessage(element, REFERENCE_DATE),
    );
    const withFile = messages.filter((message) =>
      message.attachments.some((attachment) => attachment.kind === 'file'),
    );

    expect(withFile.length).toBeGreaterThan(0);
  });

  it('resolves an absolute timestamp without help from the capture date', () => {
    const messages = findMessageElements(loadThread('thread-absolute-dates.html')).map(
      (element) => parseMessage(element, REFERENCE_DATE),
    );

    expect(messages[0]?.displayedAt).toBe('15 July 2026, 17:38');
    expect(messages[0]?.sentAt).toBe(new Date(2026, 6, 15, 17, 38).toISOString());
    expect(messages[0]?.warnings).not.toContain('INFERRED_TIMESTAMP');
  });

  it('marks a timestamp reconstructed from the capture date as inferred', () => {
    const messages = findMessageElements(loadThread('thread-weekday-dates.html')).map(
      (element) => parseMessage(element, REFERENCE_DATE),
    );
    const tuesday = messages.find((message) => message.displayedAt === 'Tuesday 20:06');

    expect(tuesday?.sentAt).toBe(new Date(2026, 7, 25, 20, 6).toISOString());
    expect(tuesday?.warnings).toContain('INFERRED_TIMESTAMP');
  });

  it('skips rows Messenger has recycled out of view', () => {
    const log = loadThread('thread-absolute-dates.html');

    expect(log.querySelectorAll('[data-virtualized="true"]').length).toBeGreaterThan(0);
    expect(findMessageElements(log)).toHaveLength(3);
  });
});
