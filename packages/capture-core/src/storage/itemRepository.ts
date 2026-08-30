import type { CaptureDomain } from '../domain/captureDomain';
import {
  isStrongerIdentitySource,
  type IdentitySource,
} from '../domain/identity';
import type { CapturedItemBase } from '../domain/item';
import type { CollectionCaptureStats } from '../messaging/session';
import { createSearchMatcher } from '../search/textMatch';
import {
  buildCollectionStats,
  buildCollectionStatsDelta,
  type CollectionStatsDelta,
} from '../stats/collectionStats';
import {
  collectDistinctIndexKeys,
  collectIndexPage,
  collectSelectedIndexPage,
  createDatabaseHandle,
  deleteIndexRange,
  requestValue,
  type DatabaseHandle,
  type TransactionStores,
} from './idb';

export const FINGERPRINT_INDEX = 'by_fingerprint';

// Greater than any string a record can hold, so a compound range that starts at
// one collection url ends before the next one.
const HIGHEST_KEY_CHARACTER = '\uffff';

export type ItemPage<TItem> = {
  items: TItem[];
  total: number;
  offset: number;
  limit: number;
};

// Which index a page is read in order from. The order belongs to the site — a
// group reads newest first — so the app names the indexes that provide it rather
// than the core guessing at a field.
export type ItemPageOrder = {
  // Over the field the page is ordered by, for a page across every collection.
  readonly index: string;
  // Over [collection url, that same field], for a page limited to one.
  readonly collectionIndex: string;
  readonly direction: IDBCursorDirection;
};

// What a reader is looking for, beyond the order and the collection. Both parts
// are tested against records as the order is walked, because neither one can be
// asked of an index that is already ordering by something else.
export type ItemFilter = {
  // A code the item's warnings must contain.
  readonly warning: string | null;
  // Matched case- and accent-insensitively against the item's searchable parts.
  readonly text: string | null;
};

export const EMPTY_ITEM_FILTER: ItemFilter = {
  warning: null,
  text: null,
};

export function isEmptyItemFilter(filter: ItemFilter): boolean {
  return filter.warning === null && (filter.text === null || filter.text.trim() === '');
}

// A filtered read reports whether a further page exists rather than how many
// records matched, because counting every match means walking the whole store to
// show twenty rows. An unfiltered read still answers with a total: see ItemPage.
export type ItemMatchPage<TItem> = {
  readonly items: TItem[];
  readonly offset: number;
  readonly limit: number;
  readonly hasMore: boolean;
};

export type ItemRepository<TItem extends CapturedItemBase> = {
  isBetterParse: (existingItem: TItem, incomingItem: TItem) => boolean;
  // Answers with what the batch changed about each collection's totals, so the
  // caller can move its counts without counting the store again.
  upsertItems: (items: TItem[]) => Promise<CollectionStatsDelta[]>;
  countItems: () => Promise<number>;
  listAllItems: () => Promise<TItem[]>;
  // Reads and validates every stored record, so it belongs to the paths a user
  // waits on deliberately: opening a scan, clearing data, exporting. Anything
  // that runs per batch or on a timer wants the deltas above instead.
  listCollectionStats: () => Promise<CollectionCaptureStats[]>;
  listItemsPage: (
    order: ItemPageOrder,
    offset: number,
    limit: number,
    collectionUrl?: string | null,
  ) => Promise<ItemPage<TItem>>;
  // The same page, narrowed by something no index can answer. Kept apart from
  // listItemsPage rather than folded into it because the two differ in what they
  // can report: one knows its total, the other only whether more follow.
  findItemsPage: (
    order: ItemPageOrder,
    filter: ItemFilter,
    offset: number,
    limit: number,
    collectionUrl?: string | null,
  ) => Promise<ItemMatchPage<TItem>>;
  // How many stored items carry each warning code, counted by the warning index
  // without deserialising a record. Store-wide by design: a field the parser
  // stopped reading stops being read everywhere at once, so the number that says
  // so does not belong to one collection.
  countItemsByWarning: () => Promise<ReadonlyMap<string, number>>;
  // How many items the order puts ahead of the first one at orderValue, which is
  // the offset a reader has to page to in order to arrive there. Answered by
  // counting an index range, so jumping to a date in a store of 100 000 records
  // costs no more than reading the page once you land.
  countItemsBefore: (
    order: ItemPageOrder,
    orderValue: string,
    collectionUrl?: string | null,
  ) => Promise<number>;
  clearItems: () => Promise<void>;
  clearCollectionItems: (collectionUrl: string) => Promise<void>;
  // The multi-store write hook. A domain that keeps a summary record beside its
  // items updates both here, in one transaction, so a service worker dying
  // mid-batch cannot leave the two disagreeing.
  write: DatabaseHandle['write'];
  read: DatabaseHandle['read'];
};

export function createItemRepository<
  TItem extends CapturedItemBase,
  TOptions extends object,
>(domain: CaptureDomain<TItem, TOptions>): ItemRepository<TItem> {
  const database = createDatabaseHandle(domain.storage);
  const itemStoreName = domain.storage.itemStoreName;

  function parseStoredItem(value: unknown): TItem | undefined {
    const parsed = domain.itemSchema.safeParse(value);
    if (!parsed.success) {
      return undefined;
    }

    return parsed.data;
  }

  function parseStoredItems(values: unknown[]): TItem[] {
    return values.flatMap((value) => {
      const item = parseStoredItem(value);
      if (item === undefined) {
        return [];
      }

      return [item];
    });
  }

  // The identity key of an item without a site id is a hash of content the site
  // changes between two sightings, so a re-sighting arrives under a new key. The
  // fingerprint is what recognises it as an existing item.
  async function findStoredItem(
    store: IDBObjectStore,
    incomingItem: TItem,
  ): Promise<TItem | null> {
    const itemAtSameKey = parseStoredItem(
      await requestValue(store.get(incomingItem.identityKey)),
    );
    if (itemAtSameKey !== undefined) {
      return itemAtSameKey;
    }

    if (incomingItem.fingerprint === null) {
      return null;
    }

    const itemWithSameFingerprint = parseStoredItem(
      await requestValue(
        store.index(FINGERPRINT_INDEX).get(incomingItem.fingerprint),
      ),
    );
    if (itemWithSameFingerprint === undefined) {
      return null;
    }

    if (contradictsStoredIdentity(itemWithSameFingerprint, incomingItem)) {
      return null;
    }

    return itemWithSameFingerprint;
  }

  function resolveMergedIdentity(
    existingItem: TItem,
    incomingItem: TItem,
  ): { identityKey: string; identitySource: IdentitySource } {
    if (
      isStrongerIdentitySource(existingItem.identitySource, incomingItem.identitySource)
    ) {
      return {
        identityKey: incomingItem.identityKey,
        identitySource: incomingItem.identitySource,
      };
    }

    return {
      identityKey: existingItem.identityKey,
      identitySource: existingItem.identitySource,
    };
  }

  // A later sighting can finally expose the site id of an item first stored
  // under a content hash. The record then moves to the stronger key, so the
  // export reports the identity the item actually has.
  async function writeMergedItem(
    store: IDBObjectStore,
    existingItem: TItem,
    incomingItem: TItem,
  ): Promise<TItem> {
    const mergedItem: TItem = Object.assign(
      {},
      domain.mergeCapture(existingItem, incomingItem),
      resolveMergedIdentity(existingItem, incomingItem),
      {
        capturedAt: existingItem.capturedAt,
        updatedAt: incomingItem.updatedAt,
      },
    );

    if (mergedItem.identityKey !== existingItem.identityKey) {
      await requestValue(store.delete(existingItem.identityKey));
    }

    await requestValue(store.put(mergedItem));

    return mergedItem;
  }

  // Returns what the write changed about the collection's totals, or null when it
  // changed nothing: a sighting no better than the record already stored is not
  // written, so it moves no count.
  async function upsertItem(
    store: IDBObjectStore,
    incomingItem: TItem,
  ): Promise<CollectionStatsDelta | null> {
    const existingItem = await findStoredItem(store, incomingItem);

    if (existingItem === null) {
      await requestValue(store.put(incomingItem));
      return buildCollectionStatsDelta(null, incomingItem, domain.projection);
    }

    if (!domain.isBetterCapture(existingItem, incomingItem)) {
      return null;
    }

    const mergedItem = await writeMergedItem(store, existingItem, incomingItem);
    return buildCollectionStatsDelta(existingItem, mergedItem, domain.projection);
  }

  // Items are written one after another because two sightings of the same item
  // can land in the same batch, and concurrent lookups would both miss the
  // fingerprint of a record the other one is about to insert.
  async function upsertItemsInOrder(
    stores: TransactionStores,
    items: TItem[],
  ): Promise<CollectionStatsDelta[]> {
    const store = stores.get(itemStoreName);
    const deltas: CollectionStatsDelta[] = [];

    for (const item of items) {
      const delta = await upsertItem(store, item);
      if (delta !== null) {
        deltas.push(delta);
      }
    }

    return deltas;
  }

  async function listAllItems(): Promise<TItem[]> {
    const values = await database.read([itemStoreName], (stores) =>
      requestValue(stores.get(itemStoreName).getAll()),
    );

    return parseStoredItems(values);
  }

  return {
    isBetterParse: domain.isBetterCapture,
    listAllItems,
    write: database.write,
    read: database.read,

    upsertItems: async (items) => {
      // Records without identity material share one storage key, so they are
      // refused here rather than allowed to overwrite each other.
      const identifiableItems = items.filter((item) => domain.isIdentifiable(item));
      if (identifiableItems.length === 0) {
        return [];
      }

      return database.write([itemStoreName], (stores) =>
        upsertItemsInOrder(stores, identifiableItems),
      );
    },

    countItems: () =>
      database.read([itemStoreName], (stores) =>
        requestValue(stores.get(itemStoreName).count()),
      ),

    listCollectionStats: async () => {
      const items = await listAllItems();
      return buildCollectionStats(items, domain.projection);
    },

    listItemsPage: async (order, offset, limit, collectionUrl = null) => {
      const page = await database.read([itemStoreName], async (stores) => {
        const store = stores.get(itemStoreName);

        if (collectionUrl === null) {
          const index = store.index(order.index);
          return {
            total: await requestValue(index.count()),
            values: await collectIndexPage(index, null, offset, limit, order.direction),
          };
        }

        const index = store.index(order.collectionIndex);
        const range = collectionOrderRange(collectionUrl);

        return {
          total: await requestValue(index.count(range)),
          values: await collectIndexPage(index, range, offset, limit, order.direction),
        };
      });

      return {
        items: parseStoredItems(page.values),
        total: page.total,
        offset,
        limit,
      };
    },

    findItemsPage: async (order, filter, offset, limit, collectionUrl = null) => {
      const matchesText = createSearchMatcher(filter.text ?? '');

      const select = (value: unknown): TItem | null => {
        const item = parseStoredItem(value);
        if (item === undefined) {
          return null;
        }

        if (
          filter.warning !== null &&
          !domain.projection.readWarnings(item).includes(filter.warning)
        ) {
          return null;
        }

        if (!matchesText(domain.projection.readSearchableText(item))) {
          return null;
        }

        return item;
      };

      const page = await database.read([itemStoreName], (stores) => {
        const store = stores.get(itemStoreName);

        if (collectionUrl === null) {
          return collectSelectedIndexPage(
            store.index(order.index),
            null,
            offset,
            limit,
            order.direction,
            select,
          );
        }

        return collectSelectedIndexPage(
          store.index(order.collectionIndex),
          collectionOrderRange(collectionUrl),
          offset,
          limit,
          order.direction,
          select,
        );
      });

      return {
        items: page.selected,
        offset,
        limit,
        hasMore: page.hasMore,
      };
    },

    countItemsByWarning: async () => {
      return database.read([itemStoreName], async (stores) => {
        const index = stores.get(itemStoreName).index(domain.storage.warningIndexName);
        const warningCodes = await collectDistinctIndexKeys(index);
        const countsByWarning = new Map<string, number>();

        for (const warningCode of warningCodes) {
          countsByWarning.set(
            warningCode,
            await requestValue(index.count(IDBKeyRange.only(warningCode))),
          );
        }

        return countsByWarning;
      });
    },

    countItemsBefore: async (order, orderValue, collectionUrl = null) => {
      return database.read([itemStoreName], (stores) => {
        const store = stores.get(itemStoreName);

        if (collectionUrl === null) {
          return requestValue(
            store.index(order.index).count(precedingRange(order.direction, orderValue)),
          );
        }

        return requestValue(
          store
            .index(order.collectionIndex)
            .count(precedingCollectionRange(order.direction, orderValue, collectionUrl)),
        );
      });
    },

    clearItems: async () => {
      await database.write([itemStoreName], (stores) =>
        requestValue(stores.get(itemStoreName).clear()),
      );
    },

    clearCollectionItems: async (collectionUrl) => {
      await database.write([itemStoreName], (stores) =>
        deleteIndexRange(
          stores.get(itemStoreName).index(domain.storage.collectionIndexName),
          IDBKeyRange.only(collectionUrl),
        ),
      );
    },
  };
}

// Arrays compare element by element, so a bound that starts at the collection url
// alone and ends after its highest possible second key covers exactly that
// collection's entries.
function collectionOrderRange(collectionUrl: string): IDBKeyRange {
  return IDBKeyRange.bound(
    [collectionUrl],
    [collectionUrl, HIGHEST_KEY_CHARACTER],
  );
}

function isDescendingDirection(direction: IDBCursorDirection): boolean {
  switch (direction) {
    case 'prev':
    case 'prevunique':
      return true;
    case 'next':
    case 'nextunique':
      return false;
    default: {
      const unhandledDirection: never = direction;
      throw new Error(`Unhandled cursor direction: ${String(unhandledDirection)}`);
    }
  }
}

// Everything the order reaches before orderValue. Which side of the value that
// is depends on the direction: a preview reading newest first arrives at a day
// from above it, so the records ahead of it are the ones that sort higher.
function precedingRange(
  direction: IDBCursorDirection,
  orderValue: string,
): IDBKeyRange {
  if (isDescendingDirection(direction)) {
    return IDBKeyRange.lowerBound(orderValue, true);
  }

  return IDBKeyRange.upperBound(orderValue, true);
}

function precedingCollectionRange(
  direction: IDBCursorDirection,
  orderValue: string,
  collectionUrl: string,
): IDBKeyRange {
  if (isDescendingDirection(direction)) {
    return IDBKeyRange.bound(
      [collectionUrl, orderValue],
      [collectionUrl, HIGHEST_KEY_CHARACTER],
      true,
      false,
    );
  }

  return IDBKeyRange.bound([collectionUrl], [collectionUrl, orderValue], false, true);
}

// Two sightings that both carry a site id or url and disagree on it are
// different items, however alike their opening lines look. Merging them on a
// matching fingerprint would lose one of them.
export function contradictsStoredIdentity<TItem extends CapturedItemBase>(
  existingItem: TItem,
  incomingItem: TItem,
): boolean {
  if (
    existingItem.externalId !== null &&
    incomingItem.externalId !== null &&
    existingItem.externalId !== incomingItem.externalId
  ) {
    return true;
  }

  return (
    existingItem.externalUrl !== null &&
    incomingItem.externalUrl !== null &&
    existingItem.externalUrl !== incomingItem.externalUrl
  );
}
