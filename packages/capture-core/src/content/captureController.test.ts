import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createCaptureProtocol } from '../messaging/protocol';
import { createCaptureController } from './captureController';
import { createElementScrollTarget } from './scrollTarget';
import type { SiteAdapter } from './siteAdapter';

const FLUSH_MS = 1000;
const DWELL_MS = 1500;

// A synthetic site with one bound of its own, so a passing test here says the
// controller honours whatever a site asks of it rather than anything Messenger
// shaped.
const itemSchema = z.object({
  identityKey: z.string(),
  identitySource: z.literal('externalId'),
  fingerprint: z.string().nullable(),
  externalId: z.string().nullable(),
  externalUrl: z.string().nullable(),
  collection: z.object({ name: z.string().nullable(), url: z.string() }),
  capturedAt: z.string(),
  updatedAt: z.string(),
  text: z.string(),
});

const optionsSchema = z
  .object({ itemLimit: z.number().nullable().default(null) })
  .default({ itemLimit: null });

type SampleItem = z.infer<typeof itemSchema>;
type SampleOptions = z.infer<typeof optionsSchema>;

const DEFAULT_OPTIONS: SampleOptions = { itemLimit: null };

const protocol = createCaptureProtocol<SampleItem, SampleOptions>({
  itemSchema,
  optionsSchema,
});

type ScrollPanel = {
  element: Element;
  setScrollTop: (scrollTop: number) => void;
};

// A panel that never grows, so the scroller reports the list exhausted after the
// configured number of fruitless steps.
function renderPanel(scrollTop: number): ScrollPanel {
  document.body.innerHTML = '<div data-list></div>';
  const element = document.querySelector('[data-list]');
  if (element === null) {
    throw new Error('The panel was not rendered');
  }

  let currentScrollTop = scrollTop;
  Object.defineProperty(element, 'scrollTop', {
    configurable: true,
    get: () => currentScrollTop,
  });
  Object.defineProperty(element, 'scrollHeight', {
    configurable: true,
    get: () => 6000,
  });
  Object.defineProperty(element, 'clientHeight', {
    configurable: true,
    get: () => 800,
  });
  element.scrollBy = () => undefined;

  return {
    element,
    setScrollTop: (nextScrollTop) => {
      currentScrollTop = nextScrollTop;
    },
  };
}

function renderRows(count: number): void {
  const list = document.querySelector('[data-list]');
  if (list === null) {
    throw new Error('The panel was not rendered');
  }

  for (let index = 0; index < count; index += 1) {
    list.insertAdjacentHTML(
      'beforeend',
      `<div data-row="${String(index)}">row ${String(index)}</div>`,
    );
  }
}

type AdapterHooks = Partial<
  Pick<
    SiteAdapter<SampleItem, SampleOptions>,
    | 'beginScan'
    | 'shouldKeepScrolling'
    | 'onScrollingEnded'
    | 'resolveScrollTarget'
    | 'isCapturableItemRoot'
  >
>;

function createAdapter(hooks: AdapterHooks): SiteAdapter<SampleItem, SampleOptions> {
  return {
    ...hooks,
    resolvePageTarget: () => ({
      isTargetPage: true,
      collectionName: 'Sample',
      collectionUrl: 'https://example.test/c/1',
    }),
    resolveObservedRoot: () => document.querySelector('[data-list]'),
    findRenderedItemRoots: (root) => [...root.querySelectorAll('[data-row]')],
    findContainingItemRoot: (node) =>
      node instanceof Element ? node.closest('[data-row]') : null,
    isCapturableItemRoot:
      hooks.isCapturableItemRoot ?? ((element) => element.isConnected),
    captureItem: (itemRoot, collection, _options, capturedAt) => {
      const rowId = itemRoot.getAttribute('data-row') ?? 'unknown';

      return Promise.resolve({
        identityKey: `row:${rowId}`,
        identitySource: 'externalId',
        fingerprint: null,
        externalId: rowId,
        externalUrl: null,
        collection,
        capturedAt,
        updatedAt: capturedAt,
        text: itemRoot.textContent,
      });
    },
    retainIdentity: (_previousItem, incomingItem) => incomingItem,
    isBetterCapture: () => false,
    resolveScrollTarget: hooks.resolveScrollTarget ?? (() => null),
    expansions: [],
  };
}

const NO_SENDER: chrome.runtime.MessageSender = {};

function startScan(
  adapter: SiteAdapter<SampleItem, SampleOptions>,
  mode: 'auto' | 'manual',
  options: SampleOptions = DEFAULT_OPTIONS,
): Promise<unknown> {
  const controller = createCaptureController({
    adapter,
    protocol,
    defaultOptions: DEFAULT_OPTIONS,
  });

  return controller.handleContentMessage(
    { type: 'BEGIN_CAPTURE', mode, options },
    NO_SENDER,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('chrome', {
    runtime: { sendMessage: () => Promise.resolve({}) },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('createCaptureController automatic scrolling', () => {
  it('tells the adapter a scan has begun, with the options it runs under', async () => {
    renderPanel(0);
    const beginScan = vi.fn();

    await startScan(createAdapter({ beginScan }), 'auto', { itemLimit: 12 });

    expect(beginScan).toHaveBeenCalledWith({ itemLimit: 12 });
  });

  // The point of the hook: a bound the user set is enforced against the items
  // that were actually captured, not against a step count.
  it('stops scrolling once the adapter refuses to keep going', async () => {
    const panel = renderPanel(3000);
    const onScrollingEnded = vi.fn();
    const adapter = createAdapter({
      shouldKeepScrolling: () => false,
      onScrollingEnded,
      resolveScrollTarget: () => createElementScrollTarget(panel.element, 'up'),
    });

    await startScan(adapter, 'auto');
    renderRows(3);
    await vi.advanceTimersByTimeAsync(FLUSH_MS);

    expect(onScrollingEnded).toHaveBeenCalledWith(false, DEFAULT_OPTIONS);
  });

  it('reports the list having run out as the reason scrolling ended', async () => {
    const panel = renderPanel(0);
    const onScrollingEnded = vi.fn();
    const adapter = createAdapter({
      onScrollingEnded,
      resolveScrollTarget: () => createElementScrollTarget(panel.element, 'up'),
    });

    await startScan(adapter, 'auto');
    await vi.advanceTimersByTimeAsync(DWELL_MS * 10);

    expect(onScrollingEnded).toHaveBeenCalledWith(true, DEFAULT_OPTIONS);
  });

  it('reports the end of scrolling once, however many batches follow', async () => {
    const panel = renderPanel(3000);
    const onScrollingEnded = vi.fn();
    const adapter = createAdapter({
      shouldKeepScrolling: () => false,
      onScrollingEnded,
      resolveScrollTarget: () => createElementScrollTarget(panel.element, 'up'),
    });

    await startScan(adapter, 'auto');
    for (let batch = 0; batch < 3; batch += 1) {
      renderRows(2);
      await vi.advanceTimersByTimeAsync(FLUSH_MS);
    }

    expect(onScrollingEnded).toHaveBeenCalledTimes(1);
  });

  // Capture stays on after the scrolling stops, so anything the site loads
  // afterwards is still stored.
  it('keeps capturing after the scrolling has ended', async () => {
    const panel = renderPanel(3000);
    const sentRequests: unknown[] = [];
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: (request: unknown) => {
          sentRequests.push(request);
          return Promise.resolve({});
        },
      },
    });

    const adapter = createAdapter({
      shouldKeepScrolling: () => false,
      resolveScrollTarget: () => createElementScrollTarget(panel.element, 'up'),
    });

    await startScan(adapter, 'auto');
    renderRows(1);
    await vi.advanceTimersByTimeAsync(FLUSH_MS);
    renderRows(1);
    await vi.advanceTimersByTimeAsync(FLUSH_MS);

    const capturedBatches = sentRequests.filter(
      (request) =>
        typeof request === 'object' &&
        request !== null &&
        'type' in request &&
        request.type === 'ITEMS_CAPTURED',
    );

    expect(capturedBatches.length).toBeGreaterThanOrEqual(2);
  });

  // The batch that reads nothing sends no items, so this is the only message the
  // service worker gets from a scan whose rows all vanish before it reads them.
  it('reports what a batch saw even when it captured none of it', async () => {
    renderPanel(0);
    const sentRequests: unknown[] = [];
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: (request: unknown) => {
          sentRequests.push(request);
          return Promise.resolve({});
        },
      },
    });

    await startScan(
      createAdapter({ isCapturableItemRoot: () => false }),
      'manual',
    );
    renderRows(3);
    await vi.advanceTimersByTimeAsync(FLUSH_MS);

    expect(sentRequests).toContainEqual({
      type: 'ITEMS_SEEN',
      tabId: 0,
      stats: { seenItemCount: 3, unreadItemCount: 3 },
    });
    expect(
      sentRequests.filter(
        (request) =>
          typeof request === 'object' &&
          request !== null &&
          'type' in request &&
          request.type === 'ITEMS_CAPTURED',
      ),
    ).toEqual([]);
  });

  it('never asks a manual scan whether to keep scrolling', async () => {
    renderPanel(0);
    const shouldKeepScrolling = vi.fn(() => false);
    const onScrollingEnded = vi.fn();

    await startScan(createAdapter({ shouldKeepScrolling, onScrollingEnded }), 'manual');
    renderRows(3);
    await vi.advanceTimersByTimeAsync(FLUSH_MS);

    expect(shouldKeepScrolling).not.toHaveBeenCalled();
    expect(onScrollingEnded).not.toHaveBeenCalled();
  });
});
