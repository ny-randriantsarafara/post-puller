import type { CaptureDomain } from '../domain/captureDomain';
import {
  isStrongerIdentitySource,
  type IdentitySource,
} from '../domain/identity';
import type { CapturedItemBase } from '../domain/item';
import type { CollectionCaptureStats } from '../messaging/session';
import { buildCollectionStats } from '../stats/collectionStats';
import {
  createDatabaseHandle,
  requestValue,
  type DatabaseHandle,
  type TransactionStores,
} from './idb';

export const FINGERPRINT_INDEX = 'by_fingerprint';

export type ItemPage<TItem> = {
  items: TItem[];
  total: number;
  offset: number;
  limit: number;
};

export type ItemRepository<TItem extends CapturedItemBase> = {
  isBetterParse: (existingItem: TItem, incomingItem: TItem) => boolean;
  upsertItems: (items: TItem[]) => Promise<number>;
  countItems: () => Promise<number>;
  countIncompleteItems: () => Promise<number>;
  listAllItems: () => Promise<TItem[]>;
  listCollectionStats: () => Promise<CollectionCaptureStats[]>;
  listItemsPage: (
    offset: number,
    limit: number,
    collectionUrl?: string | null,
  ) => Promise<ItemPage<TItem>>;
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
  ): Promise<void> {
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
  }

  async function upsertItem(
    store: IDBObjectStore,
    incomingItem: TItem,
  ): Promise<boolean> {
    const existingItem = await findStoredItem(store, incomingItem);

    if (existingItem === null) {
      await requestValue(store.put(incomingItem));
      return true;
    }

    if (!domain.isBetterCapture(existingItem, incomingItem)) {
      return false;
    }

    await writeMergedItem(store, existingItem, incomingItem);
    return false;
  }

  // Items are written one after another because two sightings of the same item
  // can land in the same batch, and concurrent lookups would both miss the
  // fingerprint of a record the other one is about to insert.
  async function upsertItemsInOrder(
    stores: TransactionStores,
    items: TItem[],
  ): Promise<number> {
    const store = stores.get(itemStoreName);
    let insertedCount = 0;

    for (const item of items) {
      const wasInserted = await upsertItem(store, item);
      if (wasInserted) {
        insertedCount += 1;
      }
    }

    return insertedCount;
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
        return 0;
      }

      return database.write([itemStoreName], (stores) =>
        upsertItemsInOrder(stores, identifiableItems),
      );
    },

    countItems: () =>
      database.read([itemStoreName], (stores) =>
        requestValue(stores.get(itemStoreName).count()),
      ),

    countIncompleteItems: async () => {
      const items = await listAllItems();
      return items.filter((item) => domain.stats.isIncomplete(item)).length;
    },

    listCollectionStats: async () => {
      const items = await listAllItems();
      return buildCollectionStats(items, domain.stats);
    },

    listItemsPage: async (offset, limit, collectionUrl = null) => {
      const allItems = await listAllItems();
      const filteredItems =
        collectionUrl === null
          ? allItems
          : allItems.filter((item) => item.collection.url === collectionUrl);
      const sortedItems = [...filteredItems].sort((left, right) =>
        right.capturedAt.localeCompare(left.capturedAt),
      );

      return {
        items: sortedItems.slice(offset, offset + limit),
        total: sortedItems.length,
        offset,
        limit,
      };
    },

    clearItems: async () => {
      await database.write([itemStoreName], (stores) =>
        requestValue(stores.get(itemStoreName).clear()),
      );
    },

    clearCollectionItems: async (collectionUrl) => {
      const items = await listAllItems();
      const identityKeys = items
        .filter((item) => item.collection.url === collectionUrl)
        .map((item) => item.identityKey);

      if (identityKeys.length === 0) {
        return;
      }

      await database.write([itemStoreName], async (stores) => {
        const store = stores.get(itemStoreName);
        await Promise.all(
          identityKeys.map((identityKey) => requestValue(store.delete(identityKey))),
        );
      });
    },
  };
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
