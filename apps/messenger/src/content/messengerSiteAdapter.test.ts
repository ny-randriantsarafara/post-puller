import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CollectionInfo } from '@extractor/capture-core/domain';
import type { CapturedMessage } from '../shared/types/capturedMessage';
import { DEFAULT_SCAN_OPTIONS } from '../shared/types/scanOptions';
import { createMessengerSiteAdapter } from './messengerSiteAdapter';
import { createThreadScan, type ThreadScan } from './threadScan';

const THREAD_ID = '61550123456789';
const COLLECTION: CollectionInfo = {
  name: 'Alex Moreau',
  url: `https://www.messenger.com/t/${THREAD_ID}`,
};
const CAPTURED_AT = '2026-08-29T09:00:00.000Z';

const fixturesDirectory = join(import.meta.dirname, 'parsing/__fixtures__');

function loadThread(name: string): void {
  document.body.innerHTML = readFileSync(join(fixturesDirectory, name), 'utf8');
}

// A conversation has to be on screen for the adapter to have a thread to write
// under, and the canonical id is only ever about the one that is.
function openConversation(threadId: string): void {
  window.history.replaceState({}, '', `/t/${threadId}`);
}

function createAdapter(scan: ThreadScan = createThreadScan()) {
  openConversation(THREAD_ID);
  return createMessengerSiteAdapter(scan);
}

// Runs one batch the way the observer does: rebuild the anchor index, then
// capture every rendered row.
async function captureThread(
  adapter: ReturnType<typeof createAdapter>,
): Promise<CapturedMessage[]> {
  const root = adapter.resolveObservedRoot();
  if (root === null) {
    throw new Error('The fixture has no message log');
  }

  adapter.beginBatch?.();

  const captured: CapturedMessage[] = [];
  for (const row of adapter.findRenderedItemRoots(root)) {
    captured.push(
      await adapter.captureItem(row, COLLECTION, DEFAULT_SCAN_OPTIONS, CAPTURED_AT),
    );
  }

  return captured;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('messengerSiteAdapter', () => {
  it('captures every rendered message of a real thread', async () => {
    loadThread('thread-same-day.html');
    const messages = await captureThread(createAdapter());

    expect(messages.length).toBeGreaterThan(0);
    for (const message of messages) {
      expect(message.threadId).toBe(THREAD_ID);
      expect(message.identityKey).toMatch(/^msg:/);
      expect(message.sentAt).not.toBeNull();
      expect(message.sortKey).toBe(message.sentAt);
    }
  });

  it('gives every message in a real thread its own key', async () => {
    loadThread('thread-reactions.html');
    const messages = await captureThread(createAdapter());

    const keys = messages.map((message) => message.identityKey);
    expect(new Set(keys).size).toBe(messages.length);
  });

  // The idempotence requirement, checked at the parse level: capturing the same
  // DOM twice has to resolve the same keys.
  it('resolves the same keys when the same thread is captured again', async () => {
    loadThread('thread-weekday-dates.html');

    const first = await captureThread(createAdapter());
    const second = await captureThread(createAdapter());

    expect(second.map((message) => message.identityKey)).toEqual(
      first.map((message) => message.identityKey),
    );
  });

  // The heavily virtualized fixture holds 560 recycled placeholders against 3
  // rendered messages. In the samples a recycled placeholder is emptied rather
  // than left holding a stale row, so it yields no messages on its own.
  it('reads only the rendered messages of a heavily virtualized thread', () => {
    loadThread('thread-absolute-dates.html');
    const adapter = createAdapter();
    const root = adapter.resolveObservedRoot();
    if (root === null) {
      throw new Error('The fixture has no message log');
    }

    expect(document.querySelectorAll('[data-virtualized="true"]').length).toBe(560);
    expect(adapter.findRenderedItemRoots(root)).toHaveLength(3);
  });

  // The placeholders in the samples are empty, so this guard is never exercised
  // by them. It is kept because a recycled row that did keep its markup would
  // otherwise be captured as a message with no id, sender or text.
  it('refuses a message row left inside a recycled placeholder', () => {
    document.body.innerHTML = `
      <div role="log">
        <div data-virtualized="true">
          <div data-message-id="mid.$recycled0001" aria-roledescription="message"
               aria-label="At 16:15, Alex Moreau: stale"></div>
        </div>
      </div>`;
    const adapter = createAdapter();
    const root = adapter.resolveObservedRoot();
    const recycledRow = document.querySelector('div[data-message-id]');
    if (root === null || recycledRow === null) {
      throw new Error('The recycled-row fixture is invalid');
    }

    expect(adapter.findRenderedItemRoots(root)).toHaveLength(0);
    expect(adapter.isCapturableItemRoot(recycledRow)).toBe(false);
    expect(adapter.findContainingItemRoot(recycledRow)).toBeNull();
  });

  // A thread already captured under a vanity handle keeps writing to those
  // records even when reached by its numeric id.
  it('writes under the canonical thread id rather than the one in the url', async () => {
    loadThread('thread-same-day.html');
    openConversation(THREAD_ID);
    const scan = createThreadScan();
    scan.setCanonicalThreadId(THREAD_ID, 'alice.dupont');

    const messages = await captureThread(createMessengerSiteAdapter(scan));

    for (const message of messages) {
      expect(message.threadId).toBe('alice.dupont');
    }
  });
});

describe('messengerSiteAdapter timestamp anchoring', () => {
  // The whole reason the anchor index exists: a thread whose separators name a
  // real day must not have its messages dated to the day of the capture.
  it('dates messages from the day their separator names', async () => {
    loadThread('thread-absolute-dates.html');
    const messages = await captureThread(createAdapter());

    expect(messages.length).toBeGreaterThan(0);
    for (const message of messages) {
      expect(message.sentAt?.startsWith('2026-07-15')).toBe(true);
      expect(message.warnings).not.toContain('INFERRED_TIMESTAMP');
      expect(message.warnings).not.toContain('UNRESOLVED_TIMESTAMP');
    }
  });

  it('flags a timestamp it could only infer from the capture day', async () => {
    loadThread('thread-same-day.html');
    const messages = await captureThread(createAdapter());

    for (const message of messages) {
      expect(message.warnings).toContain('INFERRED_TIMESTAMP');
    }
  });

  // Anchoring must not move the key, or a message would be stored twice: once
  // before its separator scrolled in and once after.
  it('keeps the key identical whether or not the anchor was available', async () => {
    loadThread('thread-absolute-dates.html');
    const anchoredKeys = (await captureThread(createAdapter())).map(
      (message) => message.identityKey,
    );

    for (const separator of document.querySelectorAll('[data-scope="date_break"]')) {
      separator.remove();
    }
    const unanchoredKeys = (await captureThread(createAdapter())).map(
      (message) => message.identityKey,
    );

    expect(unanchoredKeys).toEqual(anchoredKeys);
  });
});
