import type { CollectionInfo } from '../domain/collection';
import type { CapturedItemBase } from '../domain/item';
import type { PageTarget } from '../domain/pageTarget';
import type { ScrollTarget } from './scrollTarget';

// One reason to click something on the page, plus the budget for doing it. The
// two hand-written expansion passes the group extractor grew are one list of
// these, and their two separate click-budget maps become one keyed by rule.
export type ExpansionRule<TItem, TOptions extends object> = {
  readonly name: string;
  readonly maxClicksPerItem: number;
  isEnabled: (options: TOptions) => boolean;
  // Read from what was just captured, so a rule only fires when the parse
  // actually reported something missing.
  needsExpansion: (item: TItem) => boolean;
  click: (itemRoot: Element, remainingClickLimit: number) => number;
};

// The DOM half of a site definition. Keeping it apart from CaptureDomain is what
// keeps the parsers and selectors out of the service worker's module graph.
export type SiteAdapter<
  TItem extends CapturedItemBase,
  TOptions extends object,
> = {
  resolvePageTarget: () => PageTarget;
  // Deliberately allowed to return null. Falling back to document.body is right
  // for a page that scrolls as a whole and wrong for a thread panel, where body
  // neither scrolls nor holds only the list, so observing it would drag in the
  // conversation list and the typing indicators as a permanent mutation storm.
  resolveObservedRoot: () => Element | null;
  findRenderedItemRoots: (root: Element) => Element[];
  findContainingItemRoot: (node: Node | null) => Element | null;
  isCapturableItemRoot: (element: Element) => boolean;
  captureItem: (
    itemRoot: Element,
    collection: CollectionInfo,
    options: TOptions,
    capturedAt: string,
  ) => Promise<TItem>;
  // Applied when the same element is parsed again, so a record keeps the key it
  // was first stored under instead of moving every time the site ages a label.
  retainIdentity: (previousItem: TItem, incomingItem: TItem) => TItem;
  isBetterCapture: (existingItem: TItem, incomingItem: TItem) => boolean;
  resolveScrollTarget: () => ScrollTarget | null;
  readonly expansions: readonly ExpansionRule<TItem, TOptions>[];
};
