import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CollectionInfo } from '../domain/collection';
import { ItemObserver } from './itemObserver';
import type { SiteAdapter } from './siteAdapter';

const FLUSH_MS = 1000;
const ROOT_RECHECK_MS = 3000;

type SampleItem = {
  identityKey: string;
  identitySource: 'externalId';
  fingerprint: string | null;
  externalId: string | null;
  externalUrl: string | null;
  collection: CollectionInfo;
  capturedAt: string;
  updatedAt: string;
  text: string;
  isTruncated: boolean;
};

type SampleOptions = { expandText: boolean };

const DEFAULT_OPTIONS: SampleOptions = { expandText: true };

function renderRow(rowId: string, text: string): string {
  return `<div data-row="${rowId}"><span data-text>${text}</span></div>`;
}

function renderList(...rows: string[]): void {
  document.body.innerHTML = `<div data-list>${rows.join('')}</div>`;
}

let expansionClicks = 0;

// A synthetic site: one container, rows keyed by an attribute, text that can be
// truncated. Nothing here is Facebook or Messenger shaped.
const sampleAdapter: SiteAdapter<SampleItem, SampleOptions> = {
  resolvePageTarget: () => ({
    isTargetPage: true,
    collectionName: 'Sample',
    collectionUrl: 'https://example.test/c/1',
  }),
  resolveObservedRoot: () => document.querySelector('[data-list]'),
  findRenderedItemRoots: (root) => [...root.querySelectorAll('[data-row]')],
  findContainingItemRoot: (node) => {
    if (!(node instanceof Element)) {
      return null;
    }

    return node.closest('[data-row]');
  },
  isCapturableItemRoot: (element) =>
    element.isConnected && element.querySelector('[data-text]') !== null,
  captureItem: (itemRoot, collection, _options, capturedAt) => {
    const rowId = itemRoot.getAttribute('data-row') ?? 'unknown';
    const text = itemRoot.querySelector('[data-text]')?.textContent ?? '';

    return Promise.resolve({
      identityKey: `row:${rowId}`,
      identitySource: 'externalId',
      fingerprint: null,
      externalId: rowId,
      externalUrl: null,
      collection,
      capturedAt,
      updatedAt: capturedAt,
      text,
      isTruncated: text.endsWith('…'),
    });
  },
  retainIdentity: (previousItem, incomingItem) => ({
    ...incomingItem,
    identityKey: previousItem.identityKey,
  }),
  isBetterCapture: (existingItem, incomingItem) =>
    incomingItem.text.length > existingItem.text.length,
  resolveScrollTarget: () => null,
  expansions: [
    {
      name: 'text',
      maxClicksPerItem: 3,
      isEnabled: (options) => options.expandText,
      needsExpansion: (item) => item.isTruncated,
      click: (_itemRoot, remainingClickLimit) => {
        if (remainingClickLimit <= 0) {
          return 0;
        }

        expansionClicks += 1;
        return 1;
      },
    },
  ],
};

function createObserver(
  onItemsCaptured: (items: SampleItem[]) => void,
): ItemObserver<SampleItem, SampleOptions> {
  return new ItemObserver({
    adapter: sampleAdapter,
    defaultOptions: DEFAULT_OPTIONS,
    callbacks: { onItemsCaptured, onInterrupted: () => undefined },
  });
}

describe('ItemObserver on a synthetic adapter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    expansionClicks = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('captures what is already rendered when it starts', async () => {
    renderList(renderRow('1', 'first'), renderRow('2', 'second'));
    const captured: SampleItem[][] = [];
    const observer = createObserver((items) => captured.push(items));

    observer.start();
    await vi.advanceTimersByTimeAsync(FLUSH_MS);
    observer.stop();

    expect(captured.flat().map((item) => item.externalId)).toEqual(['1', '2']);
  });

  it('captures a row appended after it started', async () => {
    renderList(renderRow('1', 'first'));
    const captured: SampleItem[][] = [];
    const observer = createObserver((items) => captured.push(items));

    observer.start();
    await vi.advanceTimersByTimeAsync(FLUSH_MS);

    document
      .querySelector('[data-list]')
      ?.insertAdjacentHTML('beforeend', renderRow('2', 'second'));

    await vi.advanceTimersByTimeAsync(FLUSH_MS);
    observer.stop();

    expect(captured.flat().map((item) => item.externalId)).toContain('2');
  });

  it('re-emits a row once its text grows', async () => {
    renderList(renderRow('1', 'truncated…'));
    const captured: SampleItem[][] = [];
    const observer = createObserver((items) => captured.push(items));

    observer.start();
    await vi.advanceTimersByTimeAsync(FLUSH_MS);

    const text = document.querySelector('[data-text]');
    if (text === null) {
      throw new Error('fixture is invalid');
    }
    text.textContent = 'truncated text, now shown in full';

    await vi.advanceTimersByTimeAsync(FLUSH_MS);
    observer.stop();

    expect(captured.flat().map((item) => item.text)).toContain(
      'truncated text, now shown in full',
    );
  });

  it('does not re-emit a row whose reparse is not better', async () => {
    renderList(renderRow('1', 'a stable row'));
    const captured: SampleItem[][] = [];
    const observer = createObserver((items) => captured.push(items));

    observer.start();
    await vi.advanceTimersByTimeAsync(FLUSH_MS);

    for (let tick = 0; tick < 4; tick += 1) {
      document.querySelector('[data-row]')?.setAttribute('data-tick', String(tick));
      await vi.advanceTimersByTimeAsync(FLUSH_MS);
    }

    observer.stop();

    expect(captured.flat()).toHaveLength(1);
  });

  it('spends an expansion budget per item rather than per element', async () => {
    renderList(renderRow('1', 'truncated…'));
    const observer = createObserver(() => undefined);

    observer.start();

    // The row node is replaced on every render, the way a virtual DOM does, so a
    // budget keyed on the element would never run out.
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await vi.advanceTimersByTimeAsync(FLUSH_MS);
      const row = document.querySelector('[data-row]');
      row?.replaceWith(row.cloneNode(true));
    }

    observer.stop();

    expect(expansionClicks).toBe(3);
  });

  it('leaves a disabled expansion rule alone', async () => {
    renderList(renderRow('1', 'truncated…'));
    const observer = createObserver(() => undefined);

    observer.start({ options: { expandText: false } });
    await vi.advanceTimersByTimeAsync(FLUSH_MS);
    observer.stop();

    expect(expansionClicks).toBe(0);
  });

  it('keeps capturing after the container is replaced', async () => {
    renderList(renderRow('1', 'first'));
    const captured: SampleItem[][] = [];
    const observer = createObserver((items) => captured.push(items));

    observer.start();
    await vi.advanceTimersByTimeAsync(FLUSH_MS);

    const replacement = document.createElement('div');
    replacement.setAttribute('data-list', '');
    replacement.innerHTML = renderRow('2', 'second');
    document.querySelector('[data-list]')?.replaceWith(replacement);

    await vi.advanceTimersByTimeAsync(ROOT_RECHECK_MS);
    observer.stop();

    expect(captured.flat().map((item) => item.externalId)).toContain('2');
  });

  it('flushes under a continuous mutation stream instead of postponing forever', async () => {
    renderList(renderRow('1', 'first'));
    const captured: SampleItem[][] = [];
    const observer = createObserver((items) => captured.push(items));
    const list = document.querySelector('[data-list]');
    if (list === null) {
      throw new Error('fixture is invalid');
    }

    observer.start();

    // Bursts arriving faster than the debounce must not hold capture off past
    // the flush deadline.
    for (let tick = 0; tick < 8; tick += 1) {
      list.append(document.createElement('div'));
      await vi.advanceTimersByTimeAsync(300);
    }

    observer.stop();

    expect(captured.flat().map((item) => item.externalId)).toContain('1');
  });

  it('skips a row the adapter refuses and keeps the rest of the batch', async () => {
    renderList(renderRow('1', 'first'), '<div data-row="2"></div>');
    const captured: SampleItem[][] = [];
    const observer = createObserver((items) => captured.push(items));

    observer.start();
    await vi.advanceTimersByTimeAsync(FLUSH_MS);
    observer.stop();

    expect(captured.flat().map((item) => item.externalId)).toEqual(['1']);
  });

  it('interrupts when the page stops being a target mid-scan', async () => {
    renderList(renderRow('1', 'first'));
    const onInterrupted = vi.fn();
    let isOnTargetPage = true;
    const observer = new ItemObserver({
      adapter: {
        ...sampleAdapter,
        resolvePageTarget: () => {
          if (!isOnTargetPage) {
            return { isTargetPage: false, collectionName: null, collectionUrl: null };
          }

          return sampleAdapter.resolvePageTarget();
        },
      },
      defaultOptions: DEFAULT_OPTIONS,
      callbacks: { onItemsCaptured: () => undefined, onInterrupted },
    });

    observer.start();
    await vi.advanceTimersByTimeAsync(FLUSH_MS);

    isOnTargetPage = false;
    document
      .querySelector('[data-list]')
      ?.insertAdjacentHTML('beforeend', renderRow('2', 'second'));
    await vi.advanceTimersByTimeAsync(FLUSH_MS);

    expect(onInterrupted).toHaveBeenCalledTimes(1);
  });
});
