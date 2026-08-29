import type { CollectionInfo } from '../domain/collection';
import type { CapturedItemBase } from '../domain/item';
import { toErrorMessage } from '../errorMessage';
import { DEFAULT_CAPTURE_TIMING, type CaptureTiming } from './captureTiming';
import type { ExpansionRule, SiteAdapter } from './siteAdapter';

export type ItemObserverCallbacks<TItem> = {
  onItemsCaptured: (items: TItem[]) => void;
  onInterrupted: () => void;
};

export type ItemObserverStartOptions<TOptions extends object> = {
  options?: TOptions;
};

export type ItemObserverConfig<
  TItem extends CapturedItemBase,
  TOptions extends object,
> = {
  readonly adapter: SiteAdapter<TItem, TOptions>;
  readonly defaultOptions: TOptions;
  readonly callbacks: ItemObserverCallbacks<TItem>;
  readonly timing?: CaptureTiming;
};

type PendingExpansion<TItem extends CapturedItemBase, TOptions extends object> = {
  rule: ExpansionRule<TItem, TOptions>;
  element: Element;
  identityKey: string;
};

export class ItemObserver<
  TItem extends CapturedItemBase,
  TOptions extends object,
> {
  private readonly adapter: SiteAdapter<TItem, TOptions>;
  private readonly defaultOptions: TOptions;
  private readonly callbacks: ItemObserverCallbacks<TItem>;
  private readonly timing: CaptureTiming;
  private readonly observedItems = new WeakMap<Element, TItem>();
  // One budget per rule, keyed by item identity, because a re-render swaps the
  // element node while the item stays the same.
  private readonly clickBudgets = new Map<string, Map<string, number>>();
  private readonly pendingElements = new Set<Element>();
  private captureOptions: TOptions;
  private observer: MutationObserver | null = null;
  private observedRoot: Element | null = null;
  private debounceTimer: number | null = null;
  private flushDeadline: number | null = null;
  private rootRecheckTimer: number | null = null;
  private isActive = false;

  constructor({
    adapter,
    defaultOptions,
    callbacks,
    timing,
  }: ItemObserverConfig<TItem, TOptions>) {
    this.adapter = adapter;
    this.defaultOptions = defaultOptions;
    this.callbacks = callbacks;
    this.timing = timing ?? DEFAULT_CAPTURE_TIMING;
    this.captureOptions = defaultOptions;
  }

  start(startOptions: ItemObserverStartOptions<TOptions> = {}): void {
    if (this.isActive) {
      return;
    }

    this.captureOptions = startOptions.options ?? this.defaultOptions;

    const pageTarget = this.adapter.resolvePageTarget();
    if (!pageTarget.isTargetPage || pageTarget.collectionUrl === null) {
      return;
    }

    this.isActive = true;

    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach((node) => {
            if (node instanceof Element) {
              this.collectItemElements(node);
              return;
            }

            // Expanded text arrives as a plain text node, so the item has to be
            // found from the container that received it.
            this.collectContainingItem(mutation.target);
          });
        }

        if (mutation.type === 'characterData' || mutation.type === 'attributes') {
          const target = mutation.target;
          if (target instanceof Element) {
            this.collectItemElements(target);
          }

          if (target.parentElement !== null) {
            this.collectItemElements(target.parentElement);
          }
        }
      }
    });

    this.observeRoot();

    this.rootRecheckTimer = window.setInterval(() => {
      this.observeRoot();
    }, this.timing.rootRecheckMs);
  }

  stop(): void {
    this.isActive = false;

    if (this.observer !== null) {
      this.observer.disconnect();
      this.observer = null;
    }

    this.observedRoot = null;

    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    this.flushDeadline = null;

    if (this.rootRecheckTimer !== null) {
      window.clearInterval(this.rootRecheckTimer);
      this.rootRecheckTimer = null;
    }

    this.pendingElements.clear();
    this.captureOptions = this.defaultOptions;
  }

  interrupt(): void {
    this.stop();
    this.callbacks.onInterrupted();
  }

  // Captures whatever is rendered right now, without waiting for a mutation.
  // Scanning upward needs this: the items on screen at the start are exactly the
  // ones a design that only reacts to mutations would never see.
  scanNow(): void {
    const root = this.adapter.resolveObservedRoot();
    if (root === null) {
      return;
    }

    for (const itemRoot of this.adapter.findRenderedItemRoots(root)) {
      this.pendingElements.add(itemRoot);
    }

    this.scheduleFlush();
  }

  // A single-page app can replace the whole list container, which leaves the
  // observer watching a detached node and silently stops capture. Re-attaching
  // keeps the session alive, and the follow-up scan recovers what was missed.
  private observeRoot(): void {
    if (this.observer === null) {
      return;
    }

    const root = this.adapter.resolveObservedRoot();
    if (root === null) {
      return;
    }

    if (this.observedRoot === root && root.isConnected) {
      return;
    }

    this.observer.disconnect();
    this.observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
    });
    this.observedRoot = root;

    this.scanNow();
  }

  private collectContainingItem(node: Node): void {
    const element = node instanceof Element ? node : node.parentElement;
    if (element === null) {
      return;
    }

    const containingItemRoot = this.adapter.findContainingItemRoot(element);
    if (containingItemRoot === null) {
      return;
    }

    this.pendingElements.add(containingItemRoot);
    this.scheduleFlush();
  }

  private collectItemElements(root: Element): void {
    const containingItemRoot = this.adapter.findContainingItemRoot(root);
    if (containingItemRoot !== null) {
      this.pendingElements.add(containingItemRoot);
    }

    const nestedItemRoots = this.adapter.findRenderedItemRoots(root);
    for (const itemRoot of nestedItemRoots) {
      this.pendingElements.add(itemRoot);
    }

    if (containingItemRoot !== null || nestedItemRoots.length > 0) {
      this.scheduleFlush();
    }
  }

  private scheduleFlush(): void {
    const now = Date.now();
    const deadline = this.flushDeadline ?? now + this.timing.maxFlushWaitMs;
    this.flushDeadline = deadline;

    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
    }

    const delay = Math.min(this.timing.debounceMs, Math.max(0, deadline - now));

    this.debounceTimer = window.setTimeout(() => {
      this.flushDeadline = null;
      void this.flushPendingItems();
    }, delay);
  }

  private async flushPendingItems(): Promise<void> {
    if (!this.isActive || this.pendingElements.size === 0) {
      return;
    }

    const pageTarget = this.adapter.resolvePageTarget();
    if (!pageTarget.isTargetPage || pageTarget.collectionUrl === null) {
      this.interrupt();
      return;
    }

    const collection: CollectionInfo = {
      name: pageTarget.collectionName,
      url: pageTarget.collectionUrl,
    };

    const capturedItems: TItem[] = [];
    const pendingExpansions: PendingExpansion<TItem, TOptions>[] = [];
    const elements = [...this.pendingElements];
    this.pendingElements.clear();

    this.adapter.beginBatch?.();

    for (const element of elements) {
      if (!this.adapter.isCapturableItemRoot(element)) {
        continue;
      }

      const capturedItem = await this.captureItem(element, collection);
      if (capturedItem === null) {
        continue;
      }

      for (const rule of this.adapter.expansions) {
        if (!rule.isEnabled(this.captureOptions) || !rule.needsExpansion(capturedItem)) {
          continue;
        }

        pendingExpansions.push({
          rule,
          element,
          identityKey: capturedItem.identityKey,
        });
      }

      const previousItem = this.observedItems.get(element);
      if (
        previousItem !== undefined &&
        !this.adapter.isBetterCapture(previousItem, capturedItem)
      ) {
        continue;
      }

      this.observedItems.set(element, capturedItem);
      capturedItems.push(capturedItem);
    }

    this.emitCapturedItems(capturedItems);

    // Expanding after emitting keeps capture independent of the site honouring
    // our clicks. Each click mutates the list, so the observer re-parses the
    // item and the fuller version is emitted as a better version of the same one.
    this.runExpansions(pendingExpansions);
  }

  // One unreadable item must not discard the whole batch, since the pending set
  // is already cleared by the time items are parsed.
  private async captureItem(
    element: Element,
    collection: CollectionInfo,
  ): Promise<TItem | null> {
    try {
      const capturedItem = await this.adapter.captureItem(
        element,
        collection,
        this.captureOptions,
        new Date().toISOString(),
      );
      const previousItem = this.observedItems.get(element);

      if (previousItem === undefined) {
        return capturedItem;
      }

      return this.adapter.retainIdentity(previousItem, capturedItem);
    } catch (error) {
      console.warn('Skipped an item that could not be parsed:', toErrorMessage(error));
      return null;
    }
  }

  private emitCapturedItems(items: TItem[]): void {
    for (let index = 0; index < items.length; index += this.timing.batchSize) {
      this.callbacks.onItemsCaptured(items.slice(index, index + this.timing.batchSize));
    }
  }

  private runExpansions(
    pendingExpansions: PendingExpansion<TItem, TOptions>[],
  ): void {
    for (const { rule, element, identityKey } of pendingExpansions) {
      const budget = this.clickBudgets.get(rule.name) ?? new Map<string, number>();
      const spentClicks = budget.get(identityKey) ?? 0;
      const clickCount = rule.click(element, rule.maxClicksPerItem - spentClicks);

      if (clickCount > 0) {
        budget.set(identityKey, spentClicks + clickCount);
        this.clickBudgets.set(rule.name, budget);
      }
    }
  }
}
