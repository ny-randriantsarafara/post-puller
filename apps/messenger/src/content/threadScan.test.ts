import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CapturedMessage } from '../shared/types/capturedMessage';
import { DEFAULT_SCAN_OPTIONS, type ScanOptions } from '../shared/types/scanOptions';
import { createThreadScan } from './threadScan';

const THREAD_ID = '61550123456789';
const CANONICAL_THREAD_ID = '61550999888777';
const OTHER_THREAD_ID = 'alex.moreau';

function createMessage(index: number, sentAt: string | null): CapturedMessage {
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
    sortKey: sentAt ?? `~2026-08-29T09:00:00.000Z`,
    text: `Message ${String(index)}`,
    isReply: false,
    isUnsent: false,
    reactions: [],
    attachments: [{ kind: 'none' }],
    warnings: [],
    capturedAt: '2026-08-29T09:00:00.000Z',
    updatedAt: '2026-08-29T09:00:00.000Z',
  };
}

function createBatch(from: number, count: number): CapturedMessage[] {
  return Array.from({ length: count }, (_unused, offset) =>
    createMessage(from + offset, '2026-08-19T12:00:00.000Z'),
  );
}

function withOptions(overrides: Partial<ScanOptions>): ScanOptions {
  return { ...DEFAULT_SCAN_OPTIONS, ...overrides };
}

// The scroll panel the scan reads its outcome from, in the shape a live
// conversation has: the element that scrolls sits below the log and holds the
// message rows. Whether it sits at the top is the whole difference between a
// conversation read to its first message and one that stopped answering.
function renderThread(scrollTop: number): void {
  document.body.innerHTML = `
    <div role="log">
      <div>
        <div id="panel" role="none" style="overflow-y: auto">
          <div role="article">
            <div data-message-id="mid.$one" aria-roledescription="message"></div>
          </div>
        </div>
      </div>
    </div>
  `;

  const panel = document.querySelector('#panel');
  if (panel === null) {
    throw new Error('The thread panel was not rendered');
  }

  Object.defineProperty(panel, 'scrollTop', { configurable: true, value: scrollTop });
  Object.defineProperty(panel, 'scrollHeight', { configurable: true, value: 6000 });
  Object.defineProperty(panel, 'clientHeight', { configurable: true, value: 800 });
}

const sentMessages: unknown[] = [];

beforeEach(() => {
  sentMessages.length = 0;
  renderThread(0);
  window.history.replaceState({}, '', `/t/${THREAD_ID}`);

  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage: (message: unknown) => {
        sentMessages.push(message);
        return Promise.resolve({ type: 'THREAD_RECORDED' });
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createThreadScan bounds', () => {
  it('keeps scrolling while no bound was asked for', () => {
    const scan = createThreadScan();
    scan.beginScan();

    expect(scan.shouldKeepScrolling(createBatch(1, 500), DEFAULT_SCAN_OPTIONS)).toBe(
      true,
    );
  });

  it('stops once the message limit is reached', () => {
    const scan = createThreadScan();
    const options = withOptions({ stopAtMessageLimit: 5 });
    scan.beginScan();

    expect(scan.shouldKeepScrolling(createBatch(1, 3), options)).toBe(true);
    expect(scan.shouldKeepScrolling(createBatch(4, 3), options)).toBe(false);
  });

  // A re-render emits the same message again as a better version of itself.
  // Counting those would stop a scan well before the limit the user asked for.
  it('counts a message re-emitted by a re-render only once', () => {
    const scan = createThreadScan();
    const options = withOptions({ stopAtMessageLimit: 5 });
    scan.beginScan();

    for (let pass = 0; pass < 10; pass += 1) {
      expect(scan.shouldKeepScrolling(createBatch(1, 4), options)).toBe(true);
    }
  });

  it('starts counting again for the next scan of the same page', () => {
    const scan = createThreadScan();
    const options = withOptions({ stopAtMessageLimit: 5 });

    scan.beginScan();
    expect(scan.shouldKeepScrolling(createBatch(1, 6), options)).toBe(false);

    scan.beginScan();
    expect(scan.shouldKeepScrolling(createBatch(1, 2), options)).toBe(true);
  });

  // The hard bound, which exists because a scan drives the user's own session
  // rather than an API. No option turns it off.
  it('stops a scan that has run past the hard time bound', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-29T09:00:00.000Z'));

    const scan = createThreadScan();
    scan.beginScan();
    expect(scan.shouldKeepScrolling(createBatch(1, 1), DEFAULT_SCAN_OPTIONS)).toBe(true);

    vi.setSystemTime(new Date('2026-08-29T13:00:00.000Z'));
    expect(scan.shouldKeepScrolling(createBatch(2, 1), DEFAULT_SCAN_OPTIONS)).toBe(false);

    vi.useRealTimers();
  });

  it('stops once a message older than the requested day is reached', () => {
    const scan = createThreadScan();
    const options = withOptions({ stopAtDate: '2026-08-01' });
    scan.beginScan();

    expect(
      scan.shouldKeepScrolling([createMessage(1, '2026-08-19T12:00:00.000Z')], options),
    ).toBe(true);
    expect(
      scan.shouldKeepScrolling([createMessage(2, '2026-07-31T23:59:00.000Z')], options),
    ).toBe(false);
  });

  // A message whose date never resolved says nothing about how far back the scan
  // has come, so it must not be read as passing the requested day.
  it('ignores a message with no resolved date when stopping at a day', () => {
    const scan = createThreadScan();
    const options = withOptions({ stopAtDate: '2026-08-01' });
    scan.beginScan();

    expect(scan.shouldKeepScrolling([createMessage(1, null)], options)).toBe(true);
  });
});

describe('createThreadScan thread identity', () => {
  it('uses the id in the URL when no lookup has answered', () => {
    const scan = createThreadScan();

    expect(scan.resolveThreadId()).toBe(THREAD_ID);
  });

  // A conversation first captured under a vanity handle keeps writing to those
  // records when reached by its numeric id.
  it('uses the canonical id resolved for the conversation on screen', () => {
    const scan = createThreadScan();

    scan.setCanonicalThreadId(THREAD_ID, CANONICAL_THREAD_ID);

    expect(scan.resolveThreadId()).toBe(CANONICAL_THREAD_ID);
  });

  // Messenger switches conversation by pushState, so one content script sees
  // several conversations. Applying the previous conversation's id to this one
  // files these messages under that conversation, and leaves the one on screen
  // reporting nothing captured.
  it('ignores a canonical id resolved for a different conversation', () => {
    const scan = createThreadScan();
    scan.setCanonicalThreadId(THREAD_ID, CANONICAL_THREAD_ID);

    window.history.replaceState({}, '', `/t/${OTHER_THREAD_ID}`);

    expect(scan.resolveThreadId()).toBe(OTHER_THREAD_ID);
  });

  it('has no thread to write under away from a conversation', () => {
    const scan = createThreadScan();
    window.history.replaceState({}, '', '/');

    expect(scan.resolveThreadId()).toBeNull();
  });
});

describe('createThreadScan outcome', () => {
  it('reports a conversation read to its first message', () => {
    renderThread(0);
    const scan = createThreadScan();
    scan.setCanonicalThreadId(THREAD_ID, THREAD_ID);

    scan.onScrollingEnded(true, DEFAULT_SCAN_OPTIONS);

    expect(sentMessages).toEqual([
      {
        type: 'RECORD_THREAD_SCAN',
        threadId: THREAD_ID,
        aliases: [THREAD_ID],
        title: null,
        isEncryptedThread: false,
        stopReason: 'reachedStart',
      },
    ]);
  });

  // Nothing more loads, yet the panel is not at its top. Reporting this as a
  // success would mark a partial export as a complete history.
  it('reports a conversation that stopped answering as blocked', () => {
    renderThread(2400);
    const scan = createThreadScan();
    scan.setCanonicalThreadId(THREAD_ID, THREAD_ID);

    scan.onScrollingEnded(true, DEFAULT_SCAN_OPTIONS);

    expect(sentMessages).toEqual([
      expect.objectContaining({ stopReason: 'blocked' }),
    ]);
  });

  // A conversation whose scrolling element cannot be found has not been read to
  // its start; it has told us nothing. Calling that a success is what would mark
  // every partial capture complete after a Messenger layout change.
  it('reports a conversation with no scrolling element as blocked', () => {
    document.body.innerHTML = '<div role="log"></div>';
    const scan = createThreadScan();
    scan.setCanonicalThreadId(THREAD_ID, THREAD_ID);

    scan.onScrollingEnded(true, DEFAULT_SCAN_OPTIONS);

    expect(sentMessages).toEqual([expect.objectContaining({ stopReason: 'blocked' })]);
  });

  it('reports a scan that stopped at a bound the user set', () => {
    const scan = createThreadScan();
    const options = withOptions({ stopAtMessageLimit: 5 });
    scan.setCanonicalThreadId(THREAD_ID, THREAD_ID);

    scan.beginScan();
    scan.shouldKeepScrolling(createBatch(1, 6), options);
    scan.onScrollingEnded(false, options);

    expect(sentMessages).toEqual([
      expect.objectContaining({ stopReason: 'userLimit' }),
    ]);
  });

  it('reports a scan that ran past the hard time bound as its own reason', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-29T09:00:00.000Z'));

    const scan = createThreadScan();
    scan.setCanonicalThreadId(THREAD_ID, THREAD_ID);

    scan.beginScan();
    vi.setSystemTime(new Date('2026-08-29T13:00:00.000Z'));
    scan.shouldKeepScrolling(createBatch(1, 1), DEFAULT_SCAN_OPTIONS);
    scan.onScrollingEnded(false, DEFAULT_SCAN_OPTIONS);

    vi.useRealTimers();

    expect(sentMessages).toEqual([expect.objectContaining({ stopReason: 'timeCap' })]);
  });

  // The id in the url is recorded as an alias of the canonical one, which is how
  // the same conversation reached by its other handle keeps one set of records.
  it('records the id in the url as an alias of the canonical thread', () => {
    const scan = createThreadScan();
    scan.setCanonicalThreadId(THREAD_ID, 'alice.dupont');

    scan.onScrollingEnded(true, DEFAULT_SCAN_OPTIONS);

    expect(sentMessages).toEqual([
      expect.objectContaining({ threadId: 'alice.dupont', aliases: [THREAD_ID] }),
    ]);
  });

  it('says nothing about a page that is not a conversation', () => {
    window.history.replaceState({}, '', '/marketplace');
    const scan = createThreadScan();

    scan.onScrollingEnded(true, DEFAULT_SCAN_OPTIONS);

    expect(sentMessages).toEqual([]);
  });
});
