import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { EMPTY_SCAN_STATS } from '../domain/stats';
import { createCaptureProtocol } from '../messaging/protocol';
import { buildEmptyCaptureSession, type CaptureSession } from '../messaging/session';
import type { ItemRepository } from '../storage/itemRepository';
import { createCaptureCoordinator } from './captureCoordinator';
import type { SessionStore } from './sessionStore';

// A synthetic site, so what passes here is the coordinator's own behaviour and
// not Messenger's or a group's.
const itemSchema = z.object({
  identityKey: z.string(),
  identitySource: z.literal('externalId'),
  fingerprint: z.string().nullable(),
  externalId: z.string().nullable(),
  externalUrl: z.string().nullable(),
  collection: z.object({ name: z.string().nullable(), url: z.string() }),
  capturedAt: z.string(),
  updatedAt: z.string(),
});

const optionsSchema = z.object({}).default({});

type SampleItem = z.infer<typeof itemSchema>;
type SampleOptions = z.infer<typeof optionsSchema>;

const DEFAULT_OPTIONS: SampleOptions = {};
const CAPTURING_TAB_ID = 7;

const protocol = createCaptureProtocol<SampleItem, SampleOptions>({
  itemSchema,
  optionsSchema,
});

const COPY = {
  contentScriptUnreachable: 'unreachable',
  pageInfoUnreadable: 'unreadable',
  notOnTargetPage: 'not on a target page',
};

// Reads resolve on a later turn, the way a read of chrome.storage does. A store
// that answered synchronously would hide every interleaving between two handlers
// and make this file agree with any implementation.
function createSessionStore(
  session: CaptureSession<SampleOptions>,
): SessionStore<SampleOptions> {
  let stored = session;

  return {
    emptySession: buildEmptyCaptureSession(DEFAULT_OPTIONS),
    read: async () => {
      await Promise.resolve();
      return stored;
    },
    write: async (next) => {
      await Promise.resolve();
      stored = next;
    },
    reset: () => Promise.resolve(),
  };
}

// Only the reads the coordinator makes on this path are answered. Anything else
// throwing is the point: it would mean the handler touched the store, which it
// has no reason to do for counts that never reach it.
function createRepository(): ItemRepository<SampleItem> {
  const unreachable = () => {
    throw new Error('The repository was not expected to be used');
  };

  return {
    isBetterParse: () => false,
    upsertItems: unreachable,
    countItems: unreachable,
    countIncompleteItems: unreachable,
    listAllItems: unreachable,
    listCollectionStats: () => Promise.resolve([]),
    listItemsPage: unreachable,
    clearItems: unreachable,
    clearCollectionItems: unreachable,
    write: unreachable,
    read: unreachable,
  };
}

function createCoordinator(session: CaptureSession<SampleOptions>) {
  const sessionStore = createSessionStore(session);
  const coordinator = createCaptureCoordinator<SampleItem, SampleOptions>({
    domain: {
      id: 'sample',
      itemSchema,
      optionsSchema,
      defaultOptions: DEFAULT_OPTIONS,
      storage: {
        databaseName: 'sample',
        version: 1,
        itemStoreName: 'items',
        stores: [{ name: 'items', keyPath: 'identityKey', indexes: [] }],
      },
      identityKeyPrefixes: {
        externalId: 'id',
        externalUrl: 'url',
        contentHash: 'hash',
      },
      stats: {
        countChildren: () => 0,
        readPublishedAt: () => null,
        isIncomplete: () => false,
      },
      isTargetUrl: () => true,
      isBetterCapture: () => false,
      mergeCapture: (existing) => existing,
      isIdentifiable: () => true,
    },
    protocol,
    repository: createRepository(),
    sessionStore,
    copy: COPY,
  });

  return { coordinator, sessionStore };
}

function createCapturingSession(): CaptureSession<SampleOptions> {
  return {
    ...buildEmptyCaptureSession(DEFAULT_OPTIONS),
    status: 'capturing',
    tabId: CAPTURING_TAB_ID,
    collectionUrl: 'https://example.test/c/1',
    startedAt: '2026-08-29T09:00:00.000Z',
  };
}

const CAPTURING_SENDER: chrome.runtime.MessageSender = {
  tab: { id: CAPTURING_TAB_ID } as chrome.tabs.Tab,
};

let session: CaptureSession<SampleOptions>;

// Starting a scan asks the tab what page it is on before anything is written, so
// the tab has to answer for that path to be reached at all.
beforeEach(() => {
  session = createCapturingSession();
  vi.stubGlobal('chrome', {
    tabs: {
      sendMessage: () =>
        Promise.resolve({
          type: 'PAGE_INFO',
          isTargetPage: true,
          collectionName: 'Sample',
          collectionUrl: 'https://example.test/c/1',
        }),
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createCaptureCoordinator counting what a scan saw', () => {
  it('adds each batch to the running totals', async () => {
    const { coordinator, sessionStore } = createCoordinator(session);

    for (const stats of [
      { seenItemCount: 10, unreadItemCount: 2 },
      { seenItemCount: 6, unreadItemCount: 1 },
    ]) {
      await coordinator.handleBackgroundMessage(
        { type: 'ITEMS_SEEN', tabId: CAPTURING_TAB_ID, stats },
        CAPTURING_SENDER,
      );
    }

    expect((await sessionStore.read()).scanStats).toEqual({
      seenItemCount: 16,
      unreadItemCount: 3,
    });
  });

  // The content script reports a batch and moves on without waiting, so two
  // messages about the same batch are in the worker at once. Handled as they
  // arrive, the second one writes a session it read before the first one changed
  // it, and the first one's counts are gone.
  it('adds batches that arrive before the previous one was answered', async () => {
    const { coordinator, sessionStore } = createCoordinator(session);

    await Promise.all(
      [
        { seenItemCount: 4, unreadItemCount: 1 },
        { seenItemCount: 3, unreadItemCount: 0 },
        { seenItemCount: 2, unreadItemCount: 2 },
      ].map((stats) =>
        coordinator.handleBackgroundMessage(
          { type: 'ITEMS_SEEN', tabId: CAPTURING_TAB_ID, stats },
          CAPTURING_SENDER,
        ),
      ),
    );

    expect((await sessionStore.read()).scanStats).toEqual({
      seenItemCount: 9,
      unreadItemCount: 3,
    });
  });

  // Counts describe a scan, so they cannot be allowed to survive it: totals kept
  // across scans would report a fault that a later scan already recovered from.
  it('starts a scan from nothing', async () => {
    const { coordinator, sessionStore } = createCoordinator({
      ...buildEmptyCaptureSession(DEFAULT_OPTIONS),
      scanStats: { seenItemCount: 400, unreadItemCount: 120 },
    });

    await coordinator.handleBackgroundMessage(
      { type: 'START_CAPTURE', tabId: CAPTURING_TAB_ID, mode: 'auto', options: {} },
      CAPTURING_SENDER,
    );

    const started = await sessionStore.read();

    // Asserted so that the reset above cannot be read off a session the start
    // path abandoned: an empty session is also what a failure to start writes.
    expect(started.status).toBe('capturing');
    expect(started.scanStats).toEqual(EMPTY_SCAN_STATS);
  });

  it('ignores a tab that is not the one being scanned', async () => {
    const { coordinator, sessionStore } = createCoordinator(session);

    await coordinator.handleBackgroundMessage(
      {
        type: 'ITEMS_SEEN',
        tabId: CAPTURING_TAB_ID,
        stats: { seenItemCount: 9, unreadItemCount: 9 },
      },
      { tab: { id: CAPTURING_TAB_ID + 1 } as chrome.tabs.Tab },
    );

    expect((await sessionStore.read()).scanStats).toEqual(EMPTY_SCAN_STATS);
  });

  it('ignores a batch that arrives after the scan stopped', async () => {
    const { coordinator, sessionStore } = createCoordinator({
      ...createCapturingSession(),
      status: 'idle',
    });

    await coordinator.handleBackgroundMessage(
      {
        type: 'ITEMS_SEEN',
        tabId: CAPTURING_TAB_ID,
        stats: { seenItemCount: 9, unreadItemCount: 9 },
      },
      CAPTURING_SENDER,
    );

    expect((await sessionStore.read()).scanStats).toEqual(EMPTY_SCAN_STATS);
  });
});
