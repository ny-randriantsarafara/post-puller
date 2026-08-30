import {
  listStoreNames,
  type ObjectStoreConfig,
  type StorageConfig,
} from '../domain/storage';

// Named access to the stores a transaction was opened over, so a write that
// spans two stores gets both from the same transaction instead of opening a
// second one that could commit independently.
export type TransactionStores = {
  get: (storeName: string) => IDBObjectStore;
};

export function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error ?? new Error('IndexedDB request failed'));
    };
  });
}

// Walks an index with a cursor rather than reading a store and slicing it.
// advance() skips to the offset without deserialising what it passes, which is
// what makes paging a store of 100 000 records affordable; reading it all to
// return twenty rows is not.
export function collectIndexPage(
  index: IDBIndex,
  range: IDBKeyRange | null,
  offset: number,
  limit: number,
  direction: IDBCursorDirection = 'next',
): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const values: unknown[] = [];
    const request = index.openCursor(range, direction);
    let hasSkipped = offset === 0;

    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor === null || values.length >= limit) {
        resolve(values);
        return;
      }

      if (!hasSkipped) {
        hasSkipped = true;
        cursor.advance(offset);
        return;
      }

      values.push(cursor.value);
      if (values.length >= limit) {
        resolve(values);
        return;
      }

      cursor.continue();
    };

    request.onerror = () => {
      reject(request.error ?? new Error('Failed to read a page from an index'));
    };
  });
}

// Walks an index applying a test the index cannot answer itself. A substring
// search and a warning filter are both of that kind: an index orders records or
// finds them under an exact key, and neither of those finds every post that
// mentions a word. One record past the page is selected so the caller can say
// whether another page exists without counting matches it will never show.
export function collectSelectedIndexPage<TSelected>(
  index: IDBIndex,
  range: IDBKeyRange | null,
  offset: number,
  limit: number,
  direction: IDBCursorDirection,
  select: (value: unknown) => TSelected | null,
): Promise<{ selected: TSelected[]; hasMore: boolean }> {
  return new Promise((resolve, reject) => {
    const selected: TSelected[] = [];
    const request = index.openCursor(range, direction);
    let skippedCount = 0;

    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor === null) {
        resolve({ selected, hasMore: false });
        return;
      }

      const selectedValue = select(cursor.value);
      if (selectedValue === null) {
        cursor.continue();
        return;
      }

      if (skippedCount < offset) {
        skippedCount += 1;
        cursor.continue();
        return;
      }

      if (selected.length === limit) {
        resolve({ selected, hasMore: true });
        return;
      }

      selected.push(selectedValue);
      cursor.continue();
    };

    request.onerror = () => {
      reject(request.error ?? new Error('Failed to select a page from an index'));
    };
  });
}

// The distinct keys an index holds, read with a key cursor so no record is
// deserialised. Over a multiEntry index of warning codes this is the vocabulary
// the store actually contains, which is what a count per code is asked for.
export function collectDistinctIndexKeys(index: IDBIndex): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const keys: string[] = [];
    const request = index.openKeyCursor(null, 'nextunique');

    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor === null) {
        resolve(keys);
        return;
      }

      if (typeof cursor.key === 'string') {
        keys.push(cursor.key);
      }

      cursor.continue();
    };

    request.onerror = () => {
      reject(request.error ?? new Error('Failed to read the keys of an index'));
    };
  });
}

// Deletes through a cursor for the same reason: the keys of one collection are
// found by walking its own range instead of reading every record in the store.
export function deleteIndexRange(index: IDBIndex, range: IDBKeyRange): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = index.openCursor(range);

    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor === null) {
        resolve();
        return;
      }

      cursor.delete();
      cursor.continue();
    };

    request.onerror = () => {
      reject(request.error ?? new Error('Failed to delete a range from an index'));
    };
  });
}

function resolveUpgradedStore(
  request: IDBOpenDBRequest,
  storeConfig: ObjectStoreConfig,
): IDBObjectStore | null {
  const database = request.result;
  if (!database.objectStoreNames.contains(storeConfig.name)) {
    return database.createObjectStore(storeConfig.name, {
      keyPath: storeConfig.keyPath,
    });
  }

  return request.transaction?.objectStore(storeConfig.name) ?? null;
}

// Rewrites the records a store already holds. An index only ever finds records
// that carry the field it indexes, so a field introduced for ordering has to be
// written into what is already stored; deriving it when a record is read leaves
// that record out of the index and therefore out of the ordered page it belongs
// in. A record the backfill cannot make sense of is left exactly as it was
// rather than aborting the upgrade with it.
function backfillStoredItems(
  store: IDBObjectStore,
  backfillItem: (value: unknown) => unknown,
): void {
  const request = store.openCursor();

  request.onsuccess = () => {
    const cursor = request.result;
    if (cursor === null) {
      return;
    }

    cursor.update(backfillItem(cursor.value));
    cursor.continue();
  };
}

// Indexes are created from the declared schema rather than imperatively per
// version. Records missing an indexed field are left out of the index by
// IndexedDB instead of failing the upgrade, which is what lets an index be
// added to a store that already holds data.
function upgradeDatabase(
  request: IDBOpenDBRequest,
  config: StorageConfig,
  oldVersion: number,
): void {
  for (const storeConfig of config.stores) {
    const store = resolveUpgradedStore(request, storeConfig);
    if (store === null) {
      continue;
    }

    for (const index of storeConfig.indexes) {
      if (store.indexNames.contains(index.name)) {
        continue;
      }

      const keyPath =
        typeof index.keyPath === 'string' ? index.keyPath : [...index.keyPath];

      store.createIndex(index.name, keyPath, {
        multiEntry: index.multiEntry ?? false,
        unique: index.unique ?? false,
      });
    }

    // Version 0 is a database that has just been created, so it holds nothing to
    // rewrite and every record written from here on carries the field already.
    if (
      config.backfillItem !== undefined &&
      oldVersion > 0 &&
      storeConfig.name === config.itemStoreName
    ) {
      backfillStoredItems(store, config.backfillItem);
    }
  }
}

export function openDatabase(config: StorageConfig): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(config.databaseName, config.version);

    request.onupgradeneeded = (event) => {
      upgradeDatabase(request, config, event.oldVersion);
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error ?? new Error('Failed to open IndexedDB'));
    };
  });
}

// The operation is started synchronously and only awaited once the transaction
// has committed. Everything it awaits internally must be an IndexedDB request,
// because awaiting anything else yields to the event loop and IndexedDB commits
// a transaction as soon as it has no pending requests left.
export function runTransaction<T>(
  database: IDBDatabase,
  storeNames: readonly string[],
  mode: IDBTransactionMode,
  operation: (stores: TransactionStores) => Promise<T>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction([...storeNames], mode);
    const result = operation({
      get: (storeName) => transaction.objectStore(storeName),
    });

    transaction.oncomplete = () => {
      result.then(resolve, reject);
    };

    transaction.onerror = () => {
      reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    };
  });
}

export type DatabaseHandle = {
  read: <T>(
    storeNames: readonly string[],
    operation: (stores: TransactionStores) => Promise<T>,
  ) => Promise<T>;
  write: <T>(
    storeNames: readonly string[],
    operation: (stores: TransactionStores) => Promise<T>,
  ) => Promise<T>;
  allStoreNames: readonly string[];
};

export function createDatabaseHandle(config: StorageConfig): DatabaseHandle {
  const allStoreNames = listStoreNames(config);

  return {
    allStoreNames,
    read: (storeNames, operation) =>
      openDatabase(config).then((database) =>
        runTransaction(database, storeNames, 'readonly', operation),
      ),
    write: (storeNames, operation) =>
      openDatabase(config).then((database) =>
        runTransaction(database, storeNames, 'readwrite', operation),
      ),
  };
}
